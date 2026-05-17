import { Hono } from 'hono';
import type { Queries, Feed } from '../../../db/queries.js';
import type { ApiFeed, ApiCategory, ApiEntrySummary, FilterMode, SortMode } from '../../shared/types.js';

const STALE_THRESHOLD_SEC = 180 * 24 * 60 * 60;

function toApiFeed(f: Feed & { latest_entry_at?: number | null }): ApiFeed {
  return {
    id: f.id,
    url: f.url,
    site_url: f.site_url,
    title: f.title,
    category_id: f.category_id,
    unread_count: f.unread_count,
    error_count: f.error_count,
    next_retry_at: f.next_retry_at,
    last_fetched_at: f.last_fetched_at,
    latest_entry_at: f.latest_entry_at ?? null,
  };
}

function applyFilter(
  feeds: Array<Feed & { latest_entry_at: number | null }>,
  filter: FilterMode
): Array<Feed & { latest_entry_at: number | null }> {
  const now = Math.floor(Date.now() / 1000);
  return feeds.filter((f) => {
    if (filter === 'all') return true;
    if (filter === 'unread') return f.unread_count > 0;
    // 'active': unread > 0 AND latest entry within 180 days
    return f.unread_count > 0 && f.latest_entry_at != null && now - f.latest_entry_at <= STALE_THRESHOLD_SEC;
  });
}

function applySort<T extends Feed & { latest_entry_at: number | null }>(
  feeds: T[],
  sort: SortMode
): T[] {
  if (sort === 'unread') {
    return [...feeds].sort((a, b) => b.unread_count - a.unread_count);
  }
  return [...feeds].sort((a, b) => (b.latest_entry_at ?? 0) - (a.latest_entry_at ?? 0));
}

export function feedsRoutes(q: Queries): Hono {
  const app = new Hono();

  app.get('/feeds', (c) => {
    const filterParam = c.req.query('filter') as FilterMode | undefined;
    const sortParam = c.req.query('sort') as SortMode | undefined;
    const filter: FilterMode = filterParam ?? 'active';
    const sort: SortMode = sortParam ?? 'latest';

    const all = q.getAllFeedsWithLatest();
    const filtered = applyFilter(all, filter);
    const sorted = applySort(filtered, sort);

    const totalUnread = all.reduce((sum, f) => sum + f.unread_count, 0);

    return c.json({
      feeds: sorted.map(toApiFeed),
      total_unread: totalUnread,
      categories: q.getCategories().map<ApiCategory>((cat) => ({
        id: cat.id,
        name: cat.name,
        parent_id: cat.parent_id,
      })),
    });
  });

  app.get('/feeds/:id/entries', (c) => {
    const idParam = c.req.param('id');
    const limit = Number(c.req.query('limit') ?? 100);
    const offset = Number(c.req.query('offset') ?? 0);

    // Special case: id = "pinned" → return pinned entries across all feeds
    if (idParam === 'pinned') {
      const pinned = q.getPinnedEntries(limit);
      const feeds = q.getAllFeeds();
      const feedMap = new Map(feeds.map((f) => [f.id, f.title]));
      const summaries: ApiEntrySummary[] = pinned.map((e) => ({
        id: e.id,
        feed_id: e.feed_id,
        feed_title: feedMap.get(e.feed_id) ?? '',
        title: e.title,
        url: e.url,
        author: e.author,
        published_at: e.published_at,
        is_read: e.is_read === 1,
        is_pinned: e.is_pinned === 1,
        has_enclosure: e.enclosure_url != null,
      }));
      return c.json({ entries: summaries });
    }

    const feedId = Number(idParam);
    if (!Number.isFinite(feedId)) return c.json({ error: 'invalid feed id' }, 400);

    const entries = q.getEntriesByFeed(feedId, limit, offset);
    const feed = q.getFeedById(feedId);
    const feedTitle = feed?.title ?? '';
    const summaries: ApiEntrySummary[] = entries.map((e) => ({
      id: e.id,
      feed_id: e.feed_id,
      feed_title: feedTitle,
      title: e.title,
      url: e.url,
      author: e.author,
      published_at: e.published_at,
      is_read: e.is_read === 1,
      is_pinned: e.is_pinned === 1,
      has_enclosure: e.enclosure_url != null,
    }));
    return c.json({ entries: summaries });
  });

  app.post('/feeds/:id/mark-all-read', (c) => {
    const feedId = Number(c.req.param('id'));
    if (!Number.isFinite(feedId)) return c.json({ error: 'invalid feed id' }, 400);
    const changed = q.markFeedAsReadById(feedId);
    return c.json({ updated_count: changed });
  });

  return app;
}
