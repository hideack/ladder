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

function makeEntry(id: number, isRead = 0): Entry {
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
    is_read: isRead,
    is_pinned: 0,
    enclosure_url: null,
    enclosure_type: null,
    enclosure_length: null,
    ai_processed: null,
  };
}

function makeQueries(entries: Entry[]) {
  return {
    getEntriesByFeed: vi.fn(() => entries),
    getPinnedEntries: vi.fn(() => []),
    searchEntries: vi.fn(() => []),
    markAsRead: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
    markFeedAsRead: vi.fn(),
  } as unknown as import('../../db/queries.js').Queries;
}

describe('EntryList navigation', async () => {
  const { EntryList } = await import('../entry-list.js');

  let entryList: InstanceType<typeof EntryList>;
  const entries = Array.from({ length: 10 }, (_, i) => makeEntry(i + 1));

  beforeEach(() => {
    entryList = new EntryList(makePane(), makeQueries(entries));
    entryList.loadFeed(1);
  });

  it('moveToTop selects first entry', () => {
    entryList.moveDown();
    entryList.moveDown();
    entryList.moveToTop();
    expect(entryList.getSelected()?.id).toBe(1);
  });

  it('moveToBottom selects last entry', () => {
    entryList.moveToBottom();
    expect(entryList.getSelected()?.id).toBe(10);
  });

  it('moveToBottom then moveToTop cycles correctly', () => {
    entryList.moveToBottom();
    entryList.moveToTop();
    expect(entryList.getSelected()?.id).toBe(1);
  });

  it('moveToTop on empty list returns null', () => {
    const emptyList = new EntryList(makePane(), makeQueries([]));
    emptyList.loadFeed(1);
    expect(emptyList.moveToTop()).toBeNull();
  });

  it('moveToBottom on empty list returns null', () => {
    const emptyList = new EntryList(makePane(), makeQueries([]));
    emptyList.loadFeed(1);
    expect(emptyList.moveToBottom()).toBeNull();
  });

  it('moveDown from bottom stays at bottom', () => {
    entryList.moveToBottom();
    entryList.moveDown();
    expect(entryList.getSelected()?.id).toBe(10);
  });
});
