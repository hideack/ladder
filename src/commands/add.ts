import RSSParser from 'rss-parser';
import fetch from 'node-fetch';
import { openDb } from '../db/schema.js';
import { Queries } from '../db/queries.js';

const parser = new RSSParser({ timeout: 10_000 });

export async function cmdAdd(url: string): Promise<void> {
  const db = openDb();
  const q = new Queries(db);

  // Check for duplicate
  const existing = q.getFeedByUrl(url);
  if (existing) {
    console.log(`Feed already subscribed: ${existing.title} (id=${existing.id})`);
    return;
  }

  console.log(`Fetching feed: ${url}`);

  let title = '';
  let siteUrl: string | undefined;
  let description: string | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let body: string;
    let etag: string | null = null;
    let lastModified: string | null = null;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ladder/0.1.0',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
        signal: controller.signal as Parameters<typeof fetch>[1] extends { signal?: infer S } ? S : never,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      etag = response.headers.get('etag');
      lastModified = response.headers.get('last-modified');
      body = await response.text();
    } finally {
      clearTimeout(timer);
    }

    const parsed = await parser.parseString(body);
    title = parsed.title ?? '';
    siteUrl = parsed.link ?? undefined;
    description = parsed.description ?? undefined;

    const feed = q.createFeed(url, title, siteUrl, description);

    // Update etag / last_modified if available
    if (etag || lastModified) {
      q.updateFeedMeta(feed.id, {
        etag: etag ?? undefined,
        last_modified: lastModified ?? undefined,
      });
    }

    // Import existing entries
    let newCount = 0;
    for (const item of parsed.items ?? []) {
      const guid = item.guid ?? item.link ?? item.title ?? String(Date.now());
      const content =
        (item as Record<string, unknown>)['contentEncoded'] as string ??
        item.content ??
        item.contentSnippet ??
        null;
      const publishedAt = item.pubDate
        ? Math.floor(new Date(item.pubDate).getTime() / 1000)
        : item.isoDate
        ? Math.floor(new Date(item.isoDate).getTime() / 1000)
        : null;

      const id = q.insertEntry({
        feed_id: feed.id,
        guid,
        url: item.link ?? null,
        title: item.title ?? '',
        content,
        author: item.author ?? null,
        published_at: publishedAt,
        is_read: 0,
        is_pinned: 0,
      });
      if (id != null) newCount++;
    }

    console.log(`Added feed: "${feed.title || url}" (id=${feed.id}), ${newCount} entries imported.`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to add feed: ${message}`);
    process.exit(1);
  }
}
