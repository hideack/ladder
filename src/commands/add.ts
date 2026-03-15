import RSSParser from 'rss-parser';
import fetch from 'node-fetch';
import { openDb } from '../db/schema.js';
import { Queries } from '../db/queries.js';
import { discoverFeedUrls, isFeedContentType } from '../crawler/discover.js';

const parser = new RSSParser({ timeout: 10_000 });

// ── ANSI helpers ────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  gray:   '\x1b[90m',
};

function info(msg: string)    { console.log(`  ${c.gray}→${c.reset} ${msg}`); }
function success(msg: string) { console.log(`${c.green}✓${c.reset} ${c.bold}${msg}${c.reset}`); }
function fail(msg: string)    { console.error(`${c.red}✗${c.reset} ${c.bold}${msg}${c.reset}`); }
function detail(key: string, val: string) {
  const padded = key.padEnd(8);
  console.log(`  ${c.gray}${padded}:${c.reset} ${val}`);
}

// ── Feed fetch & parse ───────────────────────────────────────────────────────

interface FetchedFeed {
  feedUrl: string;
  body: string;
  etag: string | null;
  lastModified: string | null;
  parsed: RSSParser.Output<Record<string, unknown>>;
}

async function fetchAndParseFeed(feedUrl: string): Promise<FetchedFeed> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  let body: string;
  let etag: string | null = null;
  let lastModified: string | null = null;

  try {
    const response = await fetch(feedUrl, {
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
  return { feedUrl, body, etag, lastModified, parsed };
}

// ── Main command ─────────────────────────────────────────────────────────────

export async function cmdAdd(url: string): Promise<void> {
  const db = openDb();
  const q = new Queries(db);

  // ── Step 1: 重複チェック ──────────────────────────────────────────────────
  const existing = q.getFeedByUrl(url);
  if (existing) {
    info(`Already subscribed: ${c.cyan}${existing.title}${c.reset} (id=${existing.id})`);
    return;
  }

  console.log(`${c.bold}Fetching:${c.reset} ${c.cyan}${url}${c.reset}`);

  try {
    // ── Step 2: まず URL を直接 fetch ──────────────────────────────────────
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let body: string;
    let etag: string | null = null;
    let lastModified: string | null = null;
    let contentType: string | null = null;
    let resolvedFeedUrl = url;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ladder/0.1.0',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*',
        },
        signal: controller.signal as Parameters<typeof fetch>[1] extends { signal?: infer S } ? S : never,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      contentType = response.headers.get('content-type');
      etag = response.headers.get('etag');
      lastModified = response.headers.get('last-modified');
      body = await response.text();
    } finally {
      clearTimeout(timer);
    }

    // ── Step 3: HTML ページなら <link rel="alternate"> を探す ──────────────
    let fetched: FetchedFeed;

    const isHtml = contentType?.toLowerCase().includes('text/html') ?? false;
    const isFeed = isFeedContentType(contentType);

    if (isHtml && !isFeed) {
      info('HTML page detected. Searching for feed links...');

      const discovered = discoverFeedUrls(url, body);

      if (discovered.length === 0) {
        fail('Failed to add feed');
        detail('Reason', 'Not a valid feed and no feed links found on the page');
        detail('URL    ', url);
        process.exit(1);
      }

      // 見つかった候補を表示
      for (const d of discovered) {
        const label = d.title ? `${d.label} — ${d.title}` : d.label;
        info(`Found: ${c.cyan}${d.url}${c.reset} (${label})`);
      }

      // 最初の候補を採用
      resolvedFeedUrl = discovered[0].url;

      // 重複チェック（検出後の URL でも確認）
      if (resolvedFeedUrl !== url) {
        const existingByFeedUrl = q.getFeedByUrl(resolvedFeedUrl);
        if (existingByFeedUrl) {
          info(`Already subscribed: ${c.cyan}${existingByFeedUrl.title}${c.reset} (id=${existingByFeedUrl.id})`);
          return;
        }
      }

      info(`Fetching feed: ${c.cyan}${resolvedFeedUrl}${c.reset}`);
      fetched = await fetchAndParseFeed(resolvedFeedUrl);
    } else {
      // フィード or 不明な Content-Type → そのまま解析
      try {
        const parsed = await parser.parseString(body);
        fetched = { feedUrl: url, body, etag, lastModified, parsed };
      } catch (parseErr) {
        // Content-Type 不明でパース失敗 → HTML として発見を試みる
        info('Not recognized as a feed. Searching for feed links...');
        const discovered = discoverFeedUrls(url, body);

        if (discovered.length === 0) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          fail('Failed to add feed');
          detail('Reason ', `Not a valid feed — ${msg}`);
          detail('URL    ', url);
          process.exit(1);
        }

        for (const d of discovered) {
          const label = d.title ? `${d.label} — ${d.title}` : d.label;
          info(`Found: ${c.cyan}${d.url}${c.reset} (${label})`);
        }

        resolvedFeedUrl = discovered[0].url;

        if (resolvedFeedUrl !== url) {
          const existingByFeedUrl = q.getFeedByUrl(resolvedFeedUrl);
          if (existingByFeedUrl) {
            info(`Already subscribed: ${c.cyan}${existingByFeedUrl.title}${c.reset} (id=${existingByFeedUrl.id})`);
            return;
          }
        }

        info(`Fetching feed: ${c.cyan}${resolvedFeedUrl}${c.reset}`);
        fetched = await fetchAndParseFeed(resolvedFeedUrl);
      }
    }

    // ── Step 4: DB に登録 ─────────────────────────────────────────────────
    const { parsed } = fetched;
    const title = parsed.title ?? '';
    const siteUrl = parsed.link ?? undefined;
    const description = parsed.description ?? undefined;

    const feed = q.createFeed(resolvedFeedUrl, title, siteUrl, description);

    if (fetched.etag || fetched.lastModified) {
      q.updateFeedMeta(feed.id, {
        etag: fetched.etag ?? undefined,
        last_modified: fetched.lastModified ?? undefined,
      });
    }

    // ── Step 5: エントリーをインポート ────────────────────────────────────
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
        author: (item.author as string | undefined) ?? null,
        published_at: publishedAt,
        is_read: 0,
        is_pinned: 0,
      });
      if (id != null) newCount++;
    }

    // ── Step 6: 完了メッセージ ────────────────────────────────────────────
    console.log('');
    success(`Added feed: "${feed.title || resolvedFeedUrl}"`);
    detail('Feed   ', resolvedFeedUrl);
    if (siteUrl) detail('Site   ', siteUrl);
    if (description) detail('Desc   ', description.slice(0, 80) + (description.length > 80 ? '…' : ''));
    detail('Entries', `${newCount} imported`);
    detail('ID     ', `${feed.id}`);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('');
    fail('Failed to add feed');
    detail('Reason ', message);
    detail('URL    ', url);
    process.exit(1);
  }
}
