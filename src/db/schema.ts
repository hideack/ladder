import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export function getDbPath(): string {
  const configDir = join(homedir(), '.config', 'ladder');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return join(configDir, 'ladder.db');
}

export function openDb(dbPath?: string): Database.Database {
  const path = dbPath ?? getDbPath();
  const db = new Database(path);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -8000');

  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      parent_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS feeds (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      url             TEXT NOT NULL UNIQUE,
      site_url        TEXT,
      title           TEXT NOT NULL DEFAULT '',
      description     TEXT,
      category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      unread_count    INTEGER NOT NULL DEFAULT 0,
      etag            TEXT,
      last_modified   TEXT,
      last_fetched_at INTEGER,
      error_count     INTEGER NOT NULL DEFAULT 0,
      next_retry_at   INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS entries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id      INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      guid         TEXT NOT NULL,
      url          TEXT,
      title        TEXT NOT NULL DEFAULT '',
      content      TEXT,
      author       TEXT,
      published_at INTEGER,
      is_read      INTEGER NOT NULL DEFAULT 0,
      is_pinned    INTEGER NOT NULL DEFAULT 0,
      fetched_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(feed_id, guid)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
      title,
      content,
      content=entries,
      content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS update_unread_on_insert
    AFTER INSERT ON entries
    BEGIN
      UPDATE feeds SET unread_count = unread_count + 1
      WHERE id = NEW.feed_id AND NEW.is_read = 0;
    END;

    CREATE TRIGGER IF NOT EXISTS update_unread_on_read
    AFTER UPDATE OF is_read ON entries
    WHEN OLD.is_read != NEW.is_read
    BEGIN
      UPDATE feeds
      SET unread_count = unread_count + CASE WHEN NEW.is_read = 1 THEN -1 ELSE 1 END
      WHERE id = NEW.feed_id;
    END;

    CREATE TRIGGER IF NOT EXISTS entries_fts_insert
    AFTER INSERT ON entries
    BEGIN
      INSERT INTO entries_fts(rowid, title, content) VALUES (NEW.id, NEW.title, NEW.content);
    END;

    CREATE TRIGGER IF NOT EXISTS entries_fts_update
    AFTER UPDATE ON entries
    BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, title, content)
        VALUES('delete', OLD.id, OLD.title, OLD.content);
      INSERT INTO entries_fts(rowid, title, content) VALUES (NEW.id, NEW.title, NEW.content);
    END;

    CREATE TRIGGER IF NOT EXISTS entries_fts_delete
    AFTER DELETE ON entries
    BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, title, content)
        VALUES('delete', OLD.id, OLD.title, OLD.content);
    END;
  `);

  // Migrations for existing databases
  const cols = (db.prepare(`PRAGMA table_info(feeds)`).all() as { name: string }[]).map((r) => r.name);
  if (!cols.includes('next_retry_at')) {
    db.exec(`ALTER TABLE feeds ADD COLUMN next_retry_at INTEGER`);
  }

  const entryCols = (db.prepare(`PRAGMA table_info(entries)`).all() as { name: string }[]).map((r) => r.name);
  if (!entryCols.includes('ai_processed')) {
    db.exec(`ALTER TABLE entries ADD COLUMN ai_processed TEXT`);
  }
  if (!entryCols.includes('enclosure_url')) {
    db.exec(`ALTER TABLE entries ADD COLUMN enclosure_url TEXT`);
  }
  if (!entryCols.includes('enclosure_type')) {
    db.exec(`ALTER TABLE entries ADD COLUMN enclosure_type TEXT`);
  }
  if (!entryCols.includes('enclosure_length')) {
    db.exec(`ALTER TABLE entries ADD COLUMN enclosure_length INTEGER`);
  }
}
