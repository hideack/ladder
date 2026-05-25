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

  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

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

  const hasMigration = (name: string): boolean =>
    (db.prepare('SELECT COUNT(*) as n FROM _migrations WHERE name = ?').get(name) as { n: number }).n > 0;

  if (!hasMigration('dedup_dynamic_guids')) {
    deduplicateDynamicGuids(db);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('dedup_dynamic_guids');
  }
}

function normalizeGuidUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const p of ['_', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      u.searchParams.delete(p);
    }
    const search = u.searchParams.toString();
    return u.origin + u.pathname + (search ? '?' + search : '') + u.hash;
  } catch {
    return raw;
  }
}

function deduplicateDynamicGuids(db: Database.Database): void {
  const entries = db.prepare(
    'SELECT id, feed_id, guid, url, is_read, is_pinned FROM entries'
  ).all() as Array<{ id: number; feed_id: number; guid: string; url: string | null; is_read: number; is_pinned: number }>;

  const byNormalizedGuid = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = `${e.feed_id}\x00${normalizeGuidUrl(e.guid)}`;
    if (!byNormalizedGuid.has(key)) byNormalizedGuid.set(key, []);
    byNormalizedGuid.get(key)!.push(e);
  }

  const dupGroups = [...byNormalizedGuid.values()].filter(g => g.length > 1);
  if (dupGroups.length === 0) return;

  const run = db.transaction(() => {
    const affectedFeeds = new Set<number>();
    const updateEntry = db.prepare('UPDATE entries SET guid = ?, url = ?, is_read = ?, is_pinned = ? WHERE id = ?');
    const deleteEntry = db.prepare('DELETE FROM entries WHERE id = ?');
    const fixUnread = db.prepare(
      'UPDATE feeds SET unread_count = (SELECT COUNT(*) FROM entries WHERE feed_id = ? AND is_read = 0) WHERE id = ?'
    );

    for (const group of dupGroups) {
      group.sort((a, b) => a.id - b.id);
      const [keeper, ...dupes] = group;

      const anyRead = group.some(e => e.is_read === 1) ? 1 : 0;
      const anyPinned = group.some(e => e.is_pinned === 1) ? 1 : 0;

      updateEntry.run(
        normalizeGuidUrl(keeper.guid),
        keeper.url ? normalizeGuidUrl(keeper.url) : null,
        anyRead,
        anyPinned,
        keeper.id
      );

      for (const dupe of dupes) {
        deleteEntry.run(dupe.id);
        affectedFeeds.add(dupe.feed_id);
      }
      affectedFeeds.add(keeper.feed_id);
    }

    for (const feedId of affectedFeeds) {
      fixUnread.run(feedId, feedId);
    }
  });

  run();
}
