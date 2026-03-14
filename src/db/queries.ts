import Database from 'better-sqlite3';

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  created_at: number;
}

export interface Feed {
  id: number;
  url: string;
  site_url: string | null;
  title: string;
  description: string | null;
  category_id: number | null;
  unread_count: number;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: number | null;
  error_count: number;
  created_at: number;
}

export interface Entry {
  id: number;
  feed_id: number;
  guid: string;
  url: string | null;
  title: string;
  content: string | null;
  author: string | null;
  published_at: number | null;
  is_read: number;
  is_pinned: number;
  fetched_at: number;
}

export class Queries {
  constructor(private db: Database.Database) {}

  // ── Categories ──────────────────────────────────────────────────────────────

  getCategories(): Category[] {
    return this.db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as Category[];
  }

  getCategoryByName(name: string): Category | undefined {
    return this.db.prepare('SELECT * FROM categories WHERE name = ?').get(name) as Category | undefined;
  }

  createCategory(name: string, parentId?: number): Category {
    const stmt = this.db.prepare(
      'INSERT INTO categories (name, parent_id) VALUES (?, ?) RETURNING *'
    );
    return stmt.get(name, parentId ?? null) as Category;
  }

  renameCategory(id: number, newName: string): void {
    this.db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(newName, id);
  }

  deleteCategory(id: number): void {
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }

  // ── Feeds ───────────────────────────────────────────────────────────────────

  getAllFeeds(): Feed[] {
    return this.db.prepare('SELECT * FROM feeds ORDER BY title').all() as Feed[];
  }

  getFeedById(id: number): Feed | undefined {
    return this.db.prepare('SELECT * FROM feeds WHERE id = ?').get(id) as Feed | undefined;
  }

  getFeedByUrl(url: string): Feed | undefined {
    return this.db.prepare('SELECT * FROM feeds WHERE url = ?').get(url) as Feed | undefined;
  }

  createFeed(url: string, title: string, siteUrl?: string, description?: string): Feed {
    const stmt = this.db.prepare(
      'INSERT INTO feeds (url, title, site_url, description) VALUES (?, ?, ?, ?) RETURNING *'
    );
    return stmt.get(url, title, siteUrl ?? null, description ?? null) as Feed;
  }

  updateFeedMeta(
    id: number,
    data: Partial<
      Pick<Feed, 'title' | 'site_url' | 'description' | 'etag' | 'last_modified' | 'last_fetched_at' | 'error_count'>
    >
  ): void {
    const keys = Object.keys(data) as Array<keyof typeof data>;
    if (keys.length === 0) return;
    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => data[k]);
    this.db.prepare(`UPDATE feeds SET ${setClauses} WHERE id = ?`).run(...values, id);
  }

  moveFeedToCategory(feedId: number, categoryId: number | null): void {
    this.db.prepare('UPDATE feeds SET category_id = ? WHERE id = ?').run(categoryId, feedId);
  }

  deleteFeed(id: number): void {
    this.db.prepare('DELETE FROM feeds WHERE id = ?').run(id);
  }

  // ── Entries ─────────────────────────────────────────────────────────────────

  getEntriesByFeed(feedId: number, limit = 50, offset = 0): Entry[] {
    return this.db
      .prepare(
        'SELECT * FROM entries WHERE feed_id = ? ORDER BY published_at DESC, fetched_at DESC LIMIT ? OFFSET ?'
      )
      .all(feedId, limit, offset) as Entry[];
  }

  getEntryById(id: number): Entry | undefined {
    return this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as Entry | undefined;
  }

  insertEntry(entry: Omit<Entry, 'id' | 'fetched_at'>): number | null {
    try {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO entries
          (feed_id, guid, url, title, content, author, published_at, is_read, is_pinned)
        VALUES
          (@feed_id, @guid, @url, @title, @content, @author, @published_at, @is_read, @is_pinned)
      `);
      const result = stmt.run(entry);
      if (result.changes === 0) return null;
      return Number(result.lastInsertRowid);
    } catch {
      return null;
    }
  }

  markAsRead(entryId: number): void {
    this.db.prepare('UPDATE entries SET is_read = 1 WHERE id = ?').run(entryId);
  }

  markFeedAsRead(feedId: number): void {
    this.db.prepare('UPDATE entries SET is_read = 1 WHERE feed_id = ? AND is_read = 0').run(feedId);
    // Recalculate unread_count
    this.db
      .prepare('UPDATE feeds SET unread_count = 0 WHERE id = ?')
      .run(feedId);
  }

  togglePin(entryId: number): void {
    this.db
      .prepare('UPDATE entries SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ?')
      .run(entryId);
  }

  toggleRead(entryId: number): void {
    this.db
      .prepare('UPDATE entries SET is_read = CASE WHEN is_read = 1 THEN 0 ELSE 1 END WHERE id = ?')
      .run(entryId);
  }

  getPinnedEntries(limit = 50): Entry[] {
    return this.db
      .prepare(
        'SELECT * FROM entries WHERE is_pinned = 1 ORDER BY published_at DESC, fetched_at DESC LIMIT ?'
      )
      .all(limit) as Entry[];
  }

  searchEntries(
    query: string,
    limit = 20
  ): Array<Entry & { feed_title: string; snippet: string }> {
    return this.db
      .prepare(`
        SELECT e.*, f.title as feed_title,
               snippet(entries_fts, 0, '[', ']', '...', 20) as snippet
        FROM entries_fts
        JOIN entries e ON e.id = entries_fts.rowid
        JOIN feeds f ON f.id = e.feed_id
        WHERE entries_fts MATCH ?
        ORDER BY e.published_at DESC, e.fetched_at DESC
        LIMIT ?
      `)
      .all(query, limit) as Array<Entry & { feed_title: string; snippet: string }>;
  }

  purgeEntries(olderThanDays: number): number {
    const result = this.db
      .prepare(`
        DELETE FROM entries
        WHERE is_read = 1
          AND is_pinned = 0
          AND fetched_at < unixepoch() - (? * 86400)
      `)
      .run(olderThanDays);
    return result.changes;
  }

  getAllFeedsWithLatest(): Array<Feed & { latest_entry_at: number | null }> {
    return this.db
      .prepare(`
        SELECT f.*, MAX(e.published_at) AS latest_entry_at
        FROM feeds f
        LEFT JOIN entries e ON e.feed_id = f.id
        GROUP BY f.id
      `)
      .all() as Array<Feed & { latest_entry_at: number | null }>;
  }

  // ── Extra helpers for MCP / TUI ─────────────────────────────────────────────

  getEntriesWithFeedTitle(
    feedId: number | null,
    unreadOnly: boolean,
    pinnedOnly: boolean,
    limit: number,
    offset: number
  ): Array<Entry & { feed_title: string }> {
    const conditions: string[] = [];
    const params: (number | string)[] = [];

    if (feedId != null) {
      conditions.push('e.feed_id = ?');
      params.push(feedId);
    }
    if (unreadOnly) conditions.push('e.is_read = 0');
    if (pinnedOnly) conditions.push('e.is_pinned = 1');

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    return this.db
      .prepare(`
        SELECT e.*, f.title as feed_title
        FROM entries e
        JOIN feeds f ON f.id = e.feed_id
        ${where}
        ORDER BY e.published_at DESC, e.fetched_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params) as Array<Entry & { feed_title: string }>;
  }

  countEntries(feedId: number | null, unreadOnly: boolean, pinnedOnly: boolean): number {
    const conditions: string[] = [];
    const params: (number | string)[] = [];

    if (feedId != null) {
      conditions.push('feed_id = ?');
      params.push(feedId);
    }
    if (unreadOnly) conditions.push('is_read = 0');
    if (pinnedOnly) conditions.push('is_pinned = 1');

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM entries ${where}`)
      .get(...params) as { cnt: number };
    return row.cnt;
  }

  getEntryWithFeedTitle(id: number): (Entry & { feed_title: string }) | undefined {
    return this.db
      .prepare(`
        SELECT e.*, f.title as feed_title
        FROM entries e
        JOIN feeds f ON f.id = e.feed_id
        WHERE e.id = ?
      `)
      .get(id) as (Entry & { feed_title: string }) | undefined;
  }

  markAsReadById(entryId: number): number {
    const result = this.db
      .prepare('UPDATE entries SET is_read = 1 WHERE id = ? AND is_read = 0')
      .run(entryId);
    return result.changes;
  }

  markFeedAsReadById(feedId: number): number {
    const result = this.db
      .prepare('UPDATE entries SET is_read = 1 WHERE feed_id = ? AND is_read = 0')
      .run(feedId);
    // Reset cached count
    this.db.prepare('UPDATE feeds SET unread_count = 0 WHERE id = ?').run(feedId);
    return result.changes;
  }
}
