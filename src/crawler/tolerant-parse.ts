/**
 * XML として壊れたフィードの救済パース。
 *
 * 配信側のバグで `<description>` などに生 HTML がそのまま
 * （CDATA でもエスケープでもなく）入っていると、`<img ...>` のような
 * HTML の空要素を XML パーサが「閉じていない開始タグ」と解釈して落ちる。
 * こちらからは直せないので、厳格パースが失敗したときだけ中身を CDATA で
 * 包み直して再試行する。
 */

/** 生 HTML が混入しがちなタグ（長いものを先に並べる） */
const REPAIR_TAGS = ['content:encoded', 'description', 'summary', 'content'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// タグ名の直後は `>` か空白（属性つき開始タグ）のみを開始タグとみなす。
// `<content>` の正規表現が `<content:encoded>` を拾わないのもこの制約による。
// タグごとにループせず 1 本の正規表現で左から一度だけ走査するのが要点で、
// こうしないと `<description>` の生 HTML に含まれる `<summary>` を入れ子に
// 包んでしまい、内側の `]]>` が外側の CDATA を途中で閉じて壊れる。
const REPAIR_RE = new RegExp(
  `<(${REPAIR_TAGS.map(escapeRegExp).join('|')})((?:\\s[^>]*)?)>([\\s\\S]*?)</\\1\\s*>`,
  'g'
);

/** 対象タグの中身を CDATA で包み直した XML を返す（対象がなければ入力をそのまま返す） */
export function repairRawHtmlPayloads(raw: string): string {
  return raw.replace(REPAIR_RE, (m: string, tag: string, attrs: string, inner: string) => {
    if (attrs.trimEnd().endsWith('/')) return m; // `<description />` — 自己終了タグ
    if (inner.includes('<![CDATA[')) return m;   // 既に CDATA なら触らない
    if (!/[<>&]/.test(inner)) return m;          // 生テキストなら触らない
    const escaped = inner.replace(/]]>/g, ']]]]><![CDATA[>');
    return `<${tag}${attrs}><![CDATA[${escaped}]]></${tag}>`;
  });
}

interface ParserLike<T> {
  parseString(xml: string): Promise<T>;
}

/**
 * まず厳格にパースし、失敗したときだけ修復して再試行する。
 * 修復しても駄目なら元のパースエラーをそのまま投げる（正常系の挙動は変えない）。
 *
 * rss-parser は内部の xml2js パーサーを使い回しており、一度パースに失敗すると
 * 次の parseString が XML エラーを黙って無視する状態になる。判定が呼び出し順に
 * 依存しないよう、パースのたびに新しいインスタンスを作る。
 *
 * @param makeParser パーサーを新規に生成するファクトリ
 * @param onRepair   修復して通ったときに呼ばれる（ログ用）
 */
export async function parseFeedString<T>(
  makeParser: () => ParserLike<T>,
  body: string,
  onRepair?: () => void
): Promise<T> {
  try {
    return await makeParser().parseString(body);
  } catch (strictErr) {
    const repaired = repairRawHtmlPayloads(body);
    if (repaired === body) throw strictErr;

    let parsed: T;
    try {
      parsed = await makeParser().parseString(repaired);
    } catch {
      throw strictErr; // 修復してもなお壊れている → これまでどおりエラーで弾く
    }

    onRepair?.();
    return parsed;
  }
}
