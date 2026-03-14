import RSSParser from 'rss-parser';
import fetch from 'node-fetch';
import Database from 'better-sqlite3';
import { Queries } from '../db/queries.js';

const TIMEOUT_MS = 10_000;
const MAX_ERROR_COUNT = 5;

interface CrawlResult {
  fetched: number;
  newEntries: number;
  errors: Array<{ feed_id: number; message: string }>;
}

const parser = new RSSParser({
  timeout: TIMEOUT_MS,
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'dcCreator'],
    ],
  },
});

export async function crawlFeed(
  db: Database.Database,
  feedId?: number
): Promise<CrawlResult> {
  const q = new Queries(db);
  const feeds = feedId != null ? [q.getFeedById(feedId)].filter(Boolean) : q.getAllFeeds();

  const result: CrawlResult = { fetched: 0, newEntries: 0, errors: [] };

  for (const feed of feeds) {
    if (!feed) continue;
    if (feed.error_count >= MAX_ERROR_COUNT) {
      process.stderr.write(`[skip] feed #${feed.id} "${feed.title}" has too many errors (${feed.error_count})\n`);
      continue;
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'ladder/0.1.0 (+https://github.com/ladder)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      };
      if (feed.etag) headers['If-None-Match'] = feed.etag;
      if (feed.last_modified) headers['If-Modified-Since'] = feed.last_modified;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let response: Awaited<ReturnType<typeof fetch>>;
      try {
        response = await fetch(feed.url, { headers, signal: controller.signal as Parameters<typeof fetch>[1] extends { signal?: infer S } ? S : never });
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 304) {
        // Not Modified — nothing to do
        q.updateFeedMeta(feed.id, { last_fetched_at: Math.floor(Date.now() / 1000), error_count: 0 });
        result.fetched++;
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const body = await response.text();
      const parsed = await parser.parseString(body);

      // Update feed metadata
      const newEtag = response.headers.get('etag') ?? undefined;
      const newLastModified = response.headers.get('last-modified') ?? undefined;
      const siteUrl = parsed.link ?? feed.site_url ?? undefined;
      const title = parsed.title ?? feed.title;
      const description = parsed.description ?? feed.description ?? undefined;

      q.updateFeedMeta(feed.id, {
        title: title || feed.title,
        site_url: siteUrl ?? feed.site_url ?? undefined,
        description: description,
        etag: newEtag ?? feed.etag ?? undefined,
        last_modified: newLastModified ?? feed.last_modified ?? undefined,
        last_fetched_at: Math.floor(Date.now() / 1000),
        error_count: 0,
      });

      // Insert entries
      for (const item of parsed.items ?? []) {
        const guid = item.guid ?? item.link ?? item.title ?? String(Date.now());
        const url = item.link ?? null;
        const entryTitle = item.title ?? '';
        const content =
          (item as Record<string, unknown>)['contentEncoded'] as string ??
          item.content ??
          item.contentSnippet ??
          null;
        const author =
          item.author ??
          ((item as Record<string, unknown>)['dcCreator'] as string | undefined) ??
          null;
        const publishedAt = item.pubDate
          ? Math.floor(new Date(item.pubDate).getTime() / 1000)
          : item.isoDate
          ? Math.floor(new Date(item.isoDate).getTime() / 1000)
          : null;

        const insertedId = q.insertEntry({
          feed_id: feed.id,
          guid,
          url,
          title: entryTitle,
          content,
          author,
          published_at: publishedAt,
          is_read: 0,
          is_pinned: 0,
        });

        if (insertedId != null) result.newEntries++;
      }

      result.fetched++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[error] feed #${feed.id} "${feed.title}": ${message}\n`);
      q.updateFeedMeta(feed.id, { error_count: feed.error_count + 1 });
      result.errors.push({ feed_id: feed.id, message });
    }
  }

  return result;
}
