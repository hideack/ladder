import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openDb } from '../db/schema.js';
import { Queries } from '../db/queries.js';
import { crawlFeed } from '../crawler/index.js';

export async function startMcpServer(): Promise<void> {
  const db = openDb();
  const q = new Queries(db);

  const server = new McpServer({
    name: 'ladder',
    version: '0.1.0',
  });

  // ── list_feeds ─────────────────────────────────────────────────────────────
  server.tool(
    'list_feeds',
    'List all subscribed RSS/Atom feeds',
    {
      unread_only: z.boolean().optional().describe('Return only feeds with unread entries'),
    },
    async ({ unread_only }) => {
      const categories = q.getCategories();
      const catMap = new Map(categories.map((c) => [c.id, c.name]));

      let feeds = q.getAllFeeds();
      if (unread_only) feeds = feeds.filter((f) => f.unread_count > 0);

      const result = feeds.map((f) => ({
        id: f.id,
        title: f.title,
        url: f.url,
        category: f.category_id != null ? (catMap.get(f.category_id) ?? null) : null,
        unread_count: f.unread_count,
        last_fetched_at: f.last_fetched_at
          ? new Date(f.last_fetched_at * 1000).toISOString()
          : null,
        error_count: f.error_count,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ feeds: result }, null, 2),
          },
        ],
      };
    }
  );

  // ── list_entries ───────────────────────────────────────────────────────────
  server.tool(
    'list_entries',
    'List RSS/Atom entries with optional filtering',
    {
      feed_id: z.number().optional().describe('Filter by feed ID'),
      unread_only: z.boolean().optional().describe('Return only unread entries'),
      pinned_only: z.boolean().optional().describe('Return only pinned entries'),
      limit: z.number().optional().describe('Maximum results (default 20)'),
      offset: z.number().optional().describe('Pagination offset (default 0)'),
    },
    async ({ feed_id, unread_only, pinned_only, limit, offset }) => {
      const lim = limit ?? 20;
      const off = offset ?? 0;

      const entries = q.getEntriesWithFeedTitle(
        feed_id ?? null,
        unread_only ?? false,
        pinned_only ?? false,
        lim,
        off
      );
      const total = q.countEntries(feed_id ?? null, unread_only ?? false, pinned_only ?? false);

      const result = entries.map((e) => ({
        id: e.id,
        feed_id: e.feed_id,
        feed_title: e.feed_title,
        title: e.title,
        url: e.url,
        author: e.author,
        published_at: e.published_at
          ? new Date(e.published_at * 1000).toISOString()
          : null,
        is_read: e.is_read === 1,
        is_pinned: e.is_pinned === 1,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ entries: result, total }, null, 2),
          },
        ],
      };
    }
  );

  // ── get_entry ──────────────────────────────────────────────────────────────
  server.tool(
    'get_entry',
    'Get full details of a single entry including content',
    {
      id: z.number().describe('Entry ID'),
    },
    async ({ id }) => {
      const entry = q.getEntryWithFeedTitle(id);
      if (!entry) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Entry not found' }) }],
          isError: true,
        };
      }

      const result = {
        id: entry.id,
        feed_title: entry.feed_title,
        title: entry.title,
        url: entry.url,
        content: entry.content,
        author: entry.author,
        published_at: entry.published_at
          ? new Date(entry.published_at * 1000).toISOString()
          : null,
        is_read: entry.is_read === 1,
        is_pinned: entry.is_pinned === 1,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── search_entries ─────────────────────────────────────────────────────────
  server.tool(
    'search_entries',
    'Full-text search across entry titles and content using SQLite FTS5',
    {
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Maximum results (default 20)'),
    },
    async ({ query, limit }) => {
      const results = q.searchEntries(query, limit ?? 20);

      const entries = results.map((e) => ({
        id: e.id,
        feed_title: e.feed_title,
        title: e.title,
        url: e.url,
        published_at: e.published_at
          ? new Date(e.published_at * 1000).toISOString()
          : null,
        snippet: e.snippet,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ entries }, null, 2) }],
      };
    }
  );

  // ── get_pinned_entries ─────────────────────────────────────────────────────
  server.tool(
    'get_pinned_entries',
    'Get all pinned entries',
    {
      limit: z.number().optional().describe('Maximum results (default 50)'),
    },
    async ({ limit }) => {
      const entries = q.getPinnedEntries(limit ?? 50);

      const result = entries.map((e) => {
        const feed = q.getFeedById(e.feed_id);
        return {
          id: e.id,
          feed_id: e.feed_id,
          feed_title: feed?.title ?? '',
          title: e.title,
          url: e.url,
          author: e.author,
          published_at: e.published_at
            ? new Date(e.published_at * 1000).toISOString()
            : null,
          is_read: e.is_read === 1,
          is_pinned: true,
        };
      });

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ entries: result, total: result.length }, null, 2) },
        ],
      };
    }
  );

  // ── mark_as_read ───────────────────────────────────────────────────────────
  server.tool(
    'mark_as_read',
    'Mark one entry or all entries of a feed as read',
    {
      entry_id: z.number().optional().describe('Entry ID to mark as read'),
      feed_id: z.number().optional().describe('Feed ID — marks all its entries as read'),
    },
    async ({ entry_id, feed_id }) => {
      if (entry_id != null) {
        const count = q.markAsReadById(entry_id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ updated_count: count }) }],
        };
      }
      if (feed_id != null) {
        const count = q.markFeedAsReadById(feed_id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ updated_count: count }) }],
        };
      }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ error: 'Provide entry_id or feed_id' }) },
        ],
        isError: true,
      };
    }
  );

  // ── fetch_now ──────────────────────────────────────────────────────────────
  server.tool(
    'fetch_now',
    'Immediately crawl one or all feeds',
    {
      feed_id: z.number().optional().describe('Feed ID to crawl (omit for all feeds)'),
    },
    async ({ feed_id }) => {
      const result = await crawlFeed(db, feed_id);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                fetched_count: result.fetched,
                new_entries_count: result.newEntries,
                errors: result.errors,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
