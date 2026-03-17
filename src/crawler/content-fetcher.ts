import fetch from 'node-fetch';
import { convert } from 'html-to-text';

const TIMEOUT_MS = 15_000;

// 本文候補の HTML を優先順で探すセレクタパターン
// 正規表現で単一タグを取り出す（ネスト構造は非対応だが一般的なブログには十分）
const TAG_PATTERNS: Array<{ open: RegExp; close: RegExp }> = [
  { open: /<article(\s[^>]*)?>/i, close: /<\/article>/i },
  { open: /<main(\s[^>]*)?>/i,    close: /<\/main>/i },
];

// クラス名で本文っぽい div/section を探すパターン
const CLASS_PATTERN =
  /<(?:div|section|article)[^>]+class="[^"]*(?:post[-_]?content|entry[-_]?content|article[-_]?(?:content|body)|post[-_]?body|content[-_]?body|story[-_]?body|blog[-_]?(?:content|post)|main[-_]?content)[^"]*"[^>]*>/i;

/**
 * 指定 URL の HTML を取得し、記事本文と思われる部分をプレーンテキストに変換して返す。
 * 失敗した場合は Error を throw する。
 */
export async function fetchArticleContent(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal as Parameters<typeof fetch>[1] extends { signal?: infer S } ? S : never,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ladder-reader/0.1)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const contentHtml = extractMainContent(html);
  return htmlToPlainText(contentHtml);
}

/** HTML から本文と思われる部分を切り出す */
function extractMainContent(html: string): string {
  // <article> / <main> タグを優先
  for (const { open, close } of TAG_PATTERNS) {
    const start = html.search(open);
    if (start === -1) continue;
    const end = html.indexOf(close.source.replace(/\\/g, '').replace('/', ''), start);
    if (end !== -1) {
      // close タグ末尾まで含める
      const closeTag = html.slice(end).match(close);
      const closeEnd = closeTag ? end + closeTag[0].length : end;
      return html.slice(start, closeEnd);
    }
    // close が見つからなくても open 以降を返す
    return html.slice(start);
  }

  // クラス名パターンで div/section を探す
  const classMatch = html.match(CLASS_PATTERN);
  if (classMatch) {
    const start = html.indexOf(classMatch[0]);
    if (start !== -1) {
      // 対応する </div> か </section> を探す（簡易的にブロック末尾を推定）
      const end = findClosingTag(html, start, classMatch[0]);
      return html.slice(start, end);
    }
  }

  // フォールバック: <body> 全体
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1];

  return html;
}

/**
 * 開始位置から始まるタグの閉じタグ末尾位置を返す（簡易実装）。
 * 深いネストには対応しないが多くのブログ記事では実用上十分。
 */
function findClosingTag(html: string, openPos: number, openTagStr: string): number {
  const tagName = (openTagStr.match(/^<(\w+)/) ?? [])[1] ?? 'div';
  const openRe = new RegExp(`<${tagName}(\\s[^>]*|/)?>`, 'gi');
  const closeTag = `</${tagName}>`;

  let depth = 0;
  openRe.lastIndex = openPos;

  let pos = openPos;
  while (pos < html.length) {
    const nextOpen = html.indexOf(`<${tagName}`, pos + 1);
    const nextClose = html.toLowerCase().indexOf(closeTag, pos + 1);

    if (nextClose === -1) break;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen;
    } else {
      if (depth === 0) return nextClose + closeTag.length;
      depth--;
      pos = nextClose;
    }
  }

  // 見つからない場合は適当な末尾を返す
  return Math.min(openPos + 50_000, html.length);
}

/** HTML をプレーンテキストに変換する */
function htmlToPlainText(html: string): string {
  try {
    return convert(html, {
      wordwrap: 78,
      selectors: [
        { selector: 'a',      options: { hideLinkHrefIfSameAsText: true } },
        { selector: 'img',    format: 'skip' },
        { selector: 'nav',    format: 'skip' },
        { selector: 'header', format: 'skip' },
        { selector: 'footer', format: 'skip' },
        { selector: 'aside',  format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'style',  format: 'skip' },
      ],
    });
  } catch {
    return html.replace(/<[^>]+>/g, '');
  }
}
