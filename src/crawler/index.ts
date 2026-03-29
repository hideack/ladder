import RSSParser from 'rss-parser';
import fetch from 'node-fetch';
import Database from 'better-sqlite3';
import { Queries } from '../db/queries.js';

const TIMEOUT_MS = 10_000;
const MAX_ERROR_COUNT = 5;
const RETRY_INTERVAL_SEC = 30 * 24 * 60 * 60; // 30 days

interface CrawlResult {
  fetched: number;
  newEntries: number;
  errors: Array<{ feed_id: number; message: string }>;
}

export interface CrawlOptions {
  /** フィード1件の処理開始時に呼ばれる */
  onProgress?: (current: number, total: number, feedTitle: string) => void;
  /** スキップ・エラー等のログメッセージ */
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
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
  feedId?: number,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const { onProgress, onLog } = options;
  const log = (level: 'info' | 'warn' | 'error', msg: string) => {
    if (onLog) onLog(level, msg);
    else process.stderr.write(`[${level}] ${msg}\n`);
  };

  const q = new Queries(db);
  const feeds = feedId != null ? [q.getFeedById(feedId)].filter(Boolean) : q.getAllFeeds();
  const total = feeds.filter(Boolean).length;
  let current = 0;

  const result: CrawlResult = { fetched: 0, newEntries: 0, errors: [] };

  for (const feed of feeds) {
    if (!feed) continue;

    current++;
    const now = Math.floor(Date.now() / 1000);

    if (feed.error_count >= MAX_ERROR_COUNT) {
      // 次回リトライ時刻が未来なら休止中 → スキップ
      if (feed.next_retry_at != null && now < feed.next_retry_at) {
        const retryDate = new Date(feed.next_retry_at * 1000).toISOString().slice(0, 10);
        log('info', `feed #${feed.id} "${feed.title}" suspended until ${retryDate}`);
        onProgress?.(current, total, `[skip] ${feed.title}`);
        continue;
      }
      // リトライ時刻が来た (または未設定) → 1ヶ月ぶりのリトライを試みる
      log('info', `feed #${feed.id} "${feed.title}" monthly retry`);
    }

    onProgress?.(current, total, feed.title);

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
        q.updateFeedMeta(feed.id, { last_fetched_at: now, error_count: 0, next_retry_at: null });
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
        last_fetched_at: now,
        error_count: 0,
        next_retry_at: null,
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

        const enclosure = item.enclosure as { url?: string; type?: string; length?: string | number } | undefined;
        const enclosureUrl    = enclosure?.url    ?? null;
        const enclosureType   = enclosure?.type   ?? null;
        const enclosureLength = enclosure?.length != null ? Number(enclosure.length) : null;

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
          enclosure_url:    enclosureUrl,
          enclosure_type:   enclosureType,
          enclosure_length: enclosureLength,
        });

        if (insertedId != null) result.newEntries++;
      }

      result.fetched++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const newErrorCount = feed.error_count + 1;
      if (newErrorCount >= MAX_ERROR_COUNT) {
        const nextRetry = now + RETRY_INTERVAL_SEC;
        const retryDate = new Date(nextRetry * 1000).toISOString().slice(0, 10);
        log('error', `feed #${feed.id} "${feed.title}": ${message} — suspended, next retry ${retryDate}`);
        onProgress?.(current, total, `[error] ${feed.title}`);
        q.updateFeedMeta(feed.id, { error_count: newErrorCount, next_retry_at: nextRetry });
      } else {
        log('warn', `feed #${feed.id} "${feed.title}": ${message} (${newErrorCount}/${MAX_ERROR_COUNT})`);
        onProgress?.(current, total, `[error] ${feed.title}`);
        q.updateFeedMeta(feed.id, { error_count: newErrorCount });
      }
      result.errors.push({ feed_id: feed.id, message });
    }
  }

  return result;
}
