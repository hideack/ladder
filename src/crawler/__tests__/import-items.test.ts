import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../db/schema.js';
import { Queries } from '../../db/queries.js';
import { importItems, normalizeGuid } from '../import-items.js';

function setup() {
  const db = openDb(':memory:');
  const q = new Queries(db);
  const feed = q.createFeed('https://example.com/feed', 'Example', undefined, undefined);
  return { db, q, feedId: feed.id };
}

describe('insertEntry', () => {
  it('enclosure_* を省略しても保存できる', () => {
    // better-sqlite3 は名前つきパラメータが欠けると throw する。
    // insertEntry の catch がそれを握り潰し、ladder add が
    // 「0 imported」になっていた回帰。
    const { q, feedId } = setup();

    const id = q.insertEntry({
      feed_id: feedId,
      guid: 'g1',
      url: null,
      title: 'no enclosure',
      content: null,
      author: null,
      published_at: null,
      is_read: 0,
      is_pinned: 0,
    });

    expect(id).not.toBeNull();
    expect(q.getEntriesByFeed(feedId, 10)).toHaveLength(1);
  });

  it('重複は throw せず null を返す', () => {
    const { q, feedId } = setup();
    const row = {
      feed_id: feedId,
      guid: 'g1',
      url: null,
      title: 'dup',
      content: null,
      author: null,
      published_at: null,
      is_read: 0,
      is_pinned: 0,
    };

    expect(q.insertEntry(row)).not.toBeNull();
    expect(q.insertEntry(row)).toBeNull();
  });

  it('本物の DB エラーは握り潰さず投げる', () => {
    // 以前は catch が全部飲み込んでいたので、DB エラーが「重複」に化けていた
    const { q } = setup();

    expect(() =>
      q.insertEntry({
        feed_id: 9999, // 存在しないフィード → FOREIGN KEY 違反
        guid: 'g1',
        url: null,
        title: 'orphan',
        content: null,
        author: null,
        published_at: null,
        is_read: 0,
        is_pinned: 0,
      })
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('importItems', () => {
  it('items を取り込んで新規件数を返す', () => {
    const { q, feedId } = setup();

    const n = importItems(q, feedId, [
      { guid: 'https://example.com/1', link: 'https://example.com/1', title: 'One', pubDate: 'Thu, 20 Aug 2026 01:30:00 +0000' },
      { guid: 'https://example.com/2', link: 'https://example.com/2', title: 'Two' },
    ]);

    expect(n).toBe(2);
    const entries = q.getEntriesByFeed(feedId, 10);
    expect(entries.map((e) => e.title).sort()).toEqual(['One', 'Two']);
  });

  it('content:encoded と dc:creator を優先して取り込む', () => {
    const { q, feedId } = setup();

    importItems(q, feedId, [
      {
        guid: 'g1',
        title: 'One',
        content: '<p>short</p>',
        contentSnippet: 'short',
        contentEncoded: '<p>full body</p>',
        dcCreator: '著者',
      },
    ]);

    const [entry] = q.getEntriesByFeed(feedId, 10);
    expect(entry.content).toBe('<p>full body</p>');
    expect(entry.author).toBe('著者');
  });

  it('guid と url からトラッキングパラメータを落とす', () => {
    const { q, feedId } = setup();

    importItems(q, feedId, [
      { guid: 'https://example.com/1?utm_source=rss&id=7', link: 'https://example.com/1?utm_source=rss&id=7', title: 'One' },
    ]);

    const [entry] = q.getEntriesByFeed(feedId, 10);
    expect(entry.guid).toBe('https://example.com/1?id=7');
    expect(entry.url).toBe('https://example.com/1?id=7');
  });

  it('同じ記事を二度取り込まない（add → fetch でも重複しない）', () => {
    const { q, feedId } = setup();
    const items = [{ guid: 'https://example.com/1?utm_source=rss', link: 'https://example.com/1?utm_source=rss', title: 'One' }];

    expect(importItems(q, feedId, items)).toBe(1);
    expect(importItems(q, feedId, items)).toBe(0);
    expect(q.getEntriesByFeed(feedId, 10)).toHaveLength(1);
  });

  it('既存エントリーの enclosure_url を後から補完する', () => {
    const { q, feedId } = setup();

    importItems(q, feedId, [{ guid: 'g1', title: 'One' }]);
    expect(q.getEntriesByFeed(feedId, 10)[0].enclosure_url).toBeNull();

    importItems(q, feedId, [
      { guid: 'g1', title: 'One', enclosure: { url: 'https://example.com/a.mp3', type: 'audio/mpeg', length: '1234' } },
    ]);

    const [entry] = q.getEntriesByFeed(feedId, 10);
    expect(entry.enclosure_url).toBe('https://example.com/a.mp3');
    expect(entry.enclosure_type).toBe('audio/mpeg');
    expect(entry.enclosure_length).toBe(1234);
  });
});

describe('importItems の1件失敗', () => {
  it('壊れた1件で全体を止めず、警告して次へ進む', () => {
    const { q, feedId } = setup();
    const warnings: string[] = [];

    const n = importItems(
      q,
      feedId,
      [
        { guid: 'ok1', title: 'One' },
        // content がオブジェクト → better-sqlite3 がバインドできず throw する
        { guid: 'bad', title: 'Bad', content: {} as unknown as string },
        { guid: 'ok2', title: 'Two' },
      ],
      (m) => warnings.push(m)
    );

    expect(n).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Bad');
    expect(q.getEntriesByFeed(feedId, 10).map((e) => e.title).sort()).toEqual(['One', 'Two']);
  });
});

describe('normalizeGuid', () => {
  it('URL として解釈できない guid はそのまま返す', () => {
    expect(normalizeGuid('unique-id-12345')).toBe('unique-id-12345');
  });

  it('http(s) 以外のスキームは origin が null になる（既存の挙動）', () => {
    // Atom の `tag:` URI は `new URL()` に通ってしまい origin が "null" になる。
    // 見た目は不格好だが変換は決定的で、guid は重複判定にしか使わないので実害はない。
    // ここを直すと既存エントリーが別 guid 扱いになり、次の fetch で全部
    // 新規として入り直す（＝丸ごと重複する）ので、あえて現状維持。
    expect(normalizeGuid('tag:example.com,2026:1')).toBe('nullexample.com,2026:1');
  });
});
