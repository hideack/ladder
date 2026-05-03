import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Entry } from '../../db/queries.js';

function makePane(height = 20) {
  return {
    height,
    setContent: vi.fn(),
    scrollTo: vi.fn(),
    setLabel: vi.fn(),
    screen: { render: vi.fn() },
  } as unknown as import('neo-blessed').Widgets.BoxElement;
}

function makeEntry(id: number): Entry & { feed_title: string } {
  return {
    id,
    feed_id: 1,
    guid: `guid-${id}`,
    title: `Entry ${id}`,
    url: `https://example.com/entry${id}`,
    content: '',
    author: null,
    published_at: Math.floor(Date.now() / 1000) - id * 60,
    fetched_at: Math.floor(Date.now() / 1000),
    is_read: 0,
    is_pinned: 0,
    enclosure_url: null,
    enclosure_type: null,
    enclosure_length: null,
    ai_processed: null,
    feed_title: 'Test Feed',
  };
}

function makeQueries(entries: Array<Entry & { feed_title: string }>) {
  const feeds = [{ id: 1, unread_count: entries.length, latest_entry_at: Math.floor(Date.now() / 1000) }];
  return {
    getEntriesWithFeedTitle: vi.fn(() => entries),
    getAllFeedsWithLatest: vi.fn(() => feeds),
    markAsRead: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  } as unknown as import('../../db/queries.js').Queries;
}

describe('UnifiedEntryList navigation', async () => {
  const { UnifiedEntryList } = await import('../unified-entry-list.js');

  const entries = Array.from({ length: 8 }, (_, i) => makeEntry(i + 1));
  let list: InstanceType<typeof UnifiedEntryList>;

  beforeEach(() => {
    list = new UnifiedEntryList(makePane(), makeQueries(entries));
    list.load('all');
  });

  it('moveToTop selects first entry', () => {
    list.moveDown();
    list.moveDown();
    list.moveToTop();
    expect(list.getSelected()?.id).toBe(1);
  });

  it('moveToBottom selects last entry', () => {
    list.moveToBottom();
    expect(list.getSelected()?.id).toBe(8);
  });

  it('moveToBottom then moveToTop cycles correctly', () => {
    list.moveToBottom();
    list.moveToTop();
    expect(list.getSelected()?.id).toBe(1);
  });

  it('moveToTop on empty list returns null', () => {
    const emptyList = new UnifiedEntryList(makePane(), makeQueries([]));
    emptyList.load('all');
    expect(emptyList.moveToTop()).toBeNull();
  });

  it('moveToBottom on empty list returns null', () => {
    const emptyList = new UnifiedEntryList(makePane(), makeQueries([]));
    emptyList.load('all');
    expect(emptyList.moveToBottom()).toBeNull();
  });
});
