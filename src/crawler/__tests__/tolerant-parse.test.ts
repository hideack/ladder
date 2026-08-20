import { describe, it, expect, vi } from 'vitest';
import RSSParser from 'rss-parser';
import { parseFeedString, repairRawHtmlPayloads } from '../tolerant-parse.js';

// 配信元バグの最小再現: <description> に生 HTML（閉じない <img> ＋ </figure>）が入っている
const BROKEN_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Broken Feed</title>
    <link>https://example.com/</link>
    <item>
      <title>Item 1</title>
      <link>https://example.com/1</link>
      <description><img src="x"><figcaption>a</figcaption></figure></description>
    </item>
  </channel>
</rss>`;

const VALID_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Valid Feed</title>
    <link>https://example.com/</link>
    <item>
      <title>Item 1</title>
      <link>https://example.com/1</link>
      <description><![CDATA[<p>hello</p>]]></description>
    </item>
  </channel>
</rss>`;

describe('parseFeedString', () => {
  it('厳格パースが落ちる壊れた RSS をフォールバックで読み込める', async () => {
    // 厳格パースは失敗する
    await expect(new RSSParser().parseString(BROKEN_RSS)).rejects.toThrow();

    const onRepair = vi.fn();
    const newParser = () => new RSSParser();
    const parsed = await parseFeedString(newParser, BROKEN_RSS, onRepair);

    expect(onRepair).toHaveBeenCalledTimes(1);
    expect(parsed.title).toBe('Broken Feed');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].title).toBe('Item 1');
    expect(parsed.items[0].link).toBe('https://example.com/1');
    expect(parsed.items[0].content).toContain('<figcaption>a</figcaption>');
  });

  it('正常なフィードは修復せずそのまま読む', async () => {
    const onRepair = vi.fn();

    const parsed = await parseFeedString(() => new RSSParser(), VALID_RSS, onRepair);

    expect(onRepair).not.toHaveBeenCalled();
    expect(parsed.title).toBe('Valid Feed');
  });

  it('修復してもなお壊れている XML はエラーで弾く', async () => {
    const broken = '<rss><channel><description><b>x</b></description>';

    await expect(parseFeedString(() => new RSSParser(), broken)).rejects.toThrow();
  });
});

describe('repairRawHtmlPayloads', () => {
  it('既に CDATA のものと生テキストは触らない', () => {
    const src = '<description><![CDATA[<p>a</p>]]></description><summary>plain text</summary>';
    expect(repairRawHtmlPayloads(src)).toBe(src);
  });

  it('属性つき開始タグ・名前空間つきタグも包み直す', () => {
    const src = '<content type="html"><img src="x"></content><content:encoded><b>y</b></content:encoded>';
    expect(repairRawHtmlPayloads(src)).toBe(
      '<content type="html"><![CDATA[<img src="x">]]></content>' +
        '<content:encoded><![CDATA[<b>y</b>]]></content:encoded>'
    );
  });

  it('入れ子のタグを二重に包まない（外側の CDATA を壊さない）', async () => {
    // <description> の生 HTML に <summary> が含まれるケース。
    // タグごとに走査すると内側の ]]> が外側の CDATA を途中で閉じてしまう。
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<rss version="2.0"><channel><title>Nested</title><link>https://example.com/</link>' +
      '<item><title>Item 1</title><link>https://example.com/1</link>' +
      '<description><details><summary><ul><li>a</li></ul></summary><img src="x"></figure></details></description>' +
      '</item></channel></rss>';

    const repaired = repairRawHtmlPayloads(xml);
    expect(repaired).toContain(
      '<description><![CDATA[<details><summary><ul><li>a</li></ul></summary><img src="x"></figure></details>]]></description>'
    );

    const parsed = await parseFeedString(() => new RSSParser(), xml);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].content).toContain('<li>a</li>');
  });

  it('中身の ]]> をエスケープする', () => {
    const out = repairRawHtmlPayloads('<description><b>a]]>b</b></description>');
    expect(out).toBe('<description><![CDATA[<b>a]]]]><![CDATA[>b</b>]]></description>');
  });
});
