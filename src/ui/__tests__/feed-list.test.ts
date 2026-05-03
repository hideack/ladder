import { describe, it, expect, vi, beforeEach } from 'vitest';

// neo-blessed の pane スタブ
function makePane(height = 20) {
  return {
    height,
    setContent: vi.fn(),
    scrollTo: vi.fn(),
    setLabel: vi.fn(),
    screen: { render: vi.fn() },
  } as unknown as import('neo-blessed').Widgets.BoxElement;
}

// Queries の最小スタブ
function makeQueries(feedCount = 5) {
  const feeds = Array.from({ length: feedCount }, (_, i) => ({
    id: i + 1,
    title: `Feed ${i + 1}`,
    url: `https://example.com/feed${i + 1}`,
    unread_count: i + 1,
    error_count: 0,
    next_retry_at: null,
    category_id: null,
    latest_entry_at: Math.floor(Date.now() / 1000) - i * 3600,
  }));

  return {
    getAllFeedsWithLatest: vi.fn(() => feeds),
    getAllFeeds: vi.fn(() => feeds),
    getCategories: vi.fn(() => []),
  } as unknown as import('../../db/queries.js').Queries;
}

describe('FeedList navigation', async () => {
  const { FeedList } = await import('../feed-list.js');

  let feedList: InstanceType<typeof FeedList>;

  beforeEach(() => {
    feedList = new FeedList(makePane(), makeQueries(5), 'all');
  });

  it('moveToTop sets selectedIndex to 0', () => {
    // まず末尾に移動
    feedList.moveDown();
    feedList.moveDown();
    feedList.moveDown();

    feedList.moveToTop();
    expect(feedList.getSelected()).toBeDefined();
    // Pinned アイテムが先頭なので type === 'pinned'
    expect(feedList.getSelected()?.type).toBe('pinned');
  });

  it('moveToBottom sets selectedIndex to last item', () => {
    feedList.moveToBottom();
    const sel = feedList.getSelected();
    expect(sel).toBeDefined();
    // 末尾はフィードのいずれか
    expect(sel?.type).toBe('feed');
  });

  it('moveToTop after moveToBottom returns to first item', () => {
    feedList.moveToBottom();
    feedList.moveToTop();
    expect(feedList.getSelected()?.type).toBe('pinned');
  });

  it('movePageDown then moveToTop resets to first', () => {
    feedList.movePageDown();
    feedList.moveToTop();
    expect(feedList.getSelected()?.type).toBe('pinned');
  });
});
