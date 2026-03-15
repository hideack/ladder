/**
 * HTML ページからフィード URL を検出するユーティリティ。
 * <link rel="alternate" type="application/rss+xml|atom+xml|feed+json" href="...">
 * タグを regex で走査し、絶対 URL のリストを返す。
 */

const FEED_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/feed+json',
  'text/xml',
];

const FEED_TYPE_LABELS: Record<string, string> = {
  'application/rss+xml': 'RSS',
  'application/atom+xml': 'Atom',
  'application/feed+json': 'JSON Feed',
  'text/xml': 'XML',
};

export interface DiscoveredFeed {
  url: string;
  type: string;
  label: string;
  title?: string;
}

/**
 * HTML 文字列から feed の <link> タグを抽出して返す。
 * href は pageUrl を基準に絶対 URL へ変換する。
 */
export function discoverFeedUrls(pageUrl: string, html: string): DiscoveredFeed[] {
  // <head> セクションのみ対象にすることで誤検知を減らす
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const headHtml = headMatch ? headMatch[0] : html.slice(0, 10_000);

  // <link ... > タグを全て抽出
  const linkTagRegex = /<link([^>]+)>/gi;
  const results: DiscoveredFeed[] = [];
  let match: RegExpExecArray | null;

  while ((match = linkTagRegex.exec(headHtml)) !== null) {
    const attrs = match[1];

    // rel="alternate" を持つものだけ対象
    if (!/rel\s*=\s*["']alternate["']/i.test(attrs)) continue;

    // type 属性を取得
    const typeMatch = attrs.match(/type\s*=\s*["']([^"']+)["']/i);
    if (!typeMatch) continue;
    const type = typeMatch[1].toLowerCase().trim();
    if (!FEED_TYPES.includes(type)) continue;

    // href 属性を取得
    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].trim();

    // 絶対 URL に変換
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }

    // title 属性（オプション）
    const titleMatch = attrs.match(/title\s*=\s*["']([^"']+)["']/i);
    const title = titleMatch ? titleMatch[1] : undefined;

    results.push({
      url: absoluteUrl,
      type,
      label: FEED_TYPE_LABELS[type] ?? type,
      title,
    });
  }

  return results;
}

/** Content-Type ヘッダー文字列がフィードを示すか判定する */
export function isFeedContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return (
    ct.includes('rss') ||
    ct.includes('atom') ||
    ct.includes('feed+json') ||
    (ct.includes('xml') && !ct.includes('html'))
  );
}
