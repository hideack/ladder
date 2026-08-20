import type { Queries } from '../db/queries.js';

/**
 * フィードの item をエントリーとして取り込む共通処理。
 *
 * `ladder add` と `ladder fetch` の両方から使う。片方だけが guid を正規化
 * したり `content:encoded` を見たりすると、同じ記事が二重に入ったり
 * 後から来たクローラーの本文が `INSERT OR IGNORE` で捨てられたりする。
 */

/** トラッキングパラメータを落として guid / URL を安定させる */
export function normalizeGuid(raw: string): string {
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

/** rss-parser の item のうち、取り込みに使う部分だけ */
export interface FeedItemLike {
  guid?: string;
  link?: string;
  title?: string;
  content?: string;
  contentSnippet?: string;
  /** customFields で `content:encoded` を割り当てたもの */
  contentEncoded?: string;
  author?: string;
  /** customFields で `dc:creator` を割り当てたもの */
  dcCreator?: string;
  pubDate?: string;
  isoDate?: string;
  enclosure?: { url?: string; type?: string; length?: string | number };
}

/**
 * items を DB に取り込み、新規に追加された件数を返す。
 * 既存エントリーは `INSERT OR IGNORE` でスキップされるが、
 * enclosure_url だけは後から補完する。
 *
 * 1件の取り込みに失敗してもフィード全体を落とさず、`onWarn` で知らせて次へ進む。
 * @param onWarn 1件が取り込めなかったときに呼ばれる（ログ用）
 */
export function importItems(
  q: Queries,
  feedId: number,
  items: readonly FeedItemLike[],
  onWarn?: (message: string) => void
): number {
  let newCount = 0;

  for (const item of items) {
    try {
      const guid = normalizeGuid(item.guid ?? item.link ?? item.title ?? String(Date.now()));
      const url = item.link ? normalizeGuid(item.link) : null;
      const content = item.contentEncoded ?? item.content ?? item.contentSnippet ?? null;
      const author = item.author ?? item.dcCreator ?? null;
      const publishedAt = item.pubDate
        ? Math.floor(new Date(item.pubDate).getTime() / 1000)
        : item.isoDate
        ? Math.floor(new Date(item.isoDate).getTime() / 1000)
        : null;

      const enclosureUrl = item.enclosure?.url ?? null;
      const enclosureType = item.enclosure?.type ?? null;
      const enclosureLength = item.enclosure?.length != null ? Number(item.enclosure.length) : null;

      const insertedId = q.insertEntry({
        feed_id: feedId,
        guid,
        url,
        title: item.title ?? '',
        content,
        author,
        published_at: publishedAt,
        is_read: 0,
        is_pinned: 0,
        enclosure_url: enclosureUrl,
        enclosure_type: enclosureType,
        enclosure_length: enclosureLength,
      });

      if (insertedId != null) {
        newCount++;
      } else if (enclosureUrl !== null) {
        // 既存エントリーで enclosure_url が未設定の場合のみ補完
        q.updateEntryEnclosure(guid, feedId, enclosureUrl, enclosureType, enclosureLength);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      onWarn?.(`failed to import entry "${item.title ?? item.link ?? item.guid ?? '?'}": ${message}`);
    }
  }

  return newCount;
}
