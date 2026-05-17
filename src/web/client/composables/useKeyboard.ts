import { onMounted, onUnmounted } from 'vue';
import { useFeedsStore } from '../stores/feeds';
import { useEntriesStore } from '../stores/entries';
import { useUiStore } from '../stores/ui';
import { api } from './useApi';

export interface ContentScroller {
  scrollBy(delta: number): void;
  scrollToTop(): void;
  scrollToBottom(): void;
  isAtBottom(): boolean;
}

const PAGE_SCROLL_PX = 400;
const PAGE_LIST_ROWS = 10;

export function useKeyboard(getContentScroller: () => ContentScroller | null) {
  const feedsStore = useFeedsStore();
  const entriesStore = useEntriesStore();
  const uiStore = useUiStore();

  let lastG = 0;

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  async function moveDownInCurrentFocus() {
    if (uiStore.focus === 'feed') {
      feedsStore.moveDown();
      await selectCurrentFeedRow();
    } else if (uiStore.focus === 'entry' || uiStore.focus === 'content') {
      await markCurrentReadIfNeeded();
      await entriesStore.moveDown();
      uiStore.setFullContent(null);
    }
  }

  async function moveUpInCurrentFocus() {
    if (uiStore.focus === 'feed') {
      feedsStore.moveUp();
      await selectCurrentFeedRow();
    } else if (uiStore.focus === 'entry' || uiStore.focus === 'content') {
      await entriesStore.moveUp();
      uiStore.setFullContent(null);
    }
  }

  async function selectCurrentFeedRow() {
    const id = feedsStore.selectedFeedId;
    if (id == null) return;
    await entriesStore.loadForFeed(id);
    uiStore.setFullContent(null);
  }

  async function markCurrentReadIfNeeded() {
    const entry = entriesStore.selectedEntry;
    if (!entry || entry.is_read) return;
    entriesStore.setEntryFlags(entry.id, { read: true });
    feedsStore.decrementUnread(entry.feed_id);
    try {
      await api.patchEntry(entry.id, { read: true });
    } catch (err) {
      console.error('mark as read failed', err);
    }
  }

  async function togglePin() {
    const entry = entriesStore.selectedEntry ?? entriesStore.detail;
    if (!entry) return;
    const next = !entry.is_pinned;
    entriesStore.setEntryFlags(entry.id, { pinned: next });
    try {
      await api.patchEntry(entry.id, { pinned: next });
    } catch (err) {
      console.error('pin toggle failed', err);
    }
  }

  async function toggleRead() {
    const entry = entriesStore.selectedEntry ?? entriesStore.detail;
    if (!entry) return;
    const next = !entry.is_read;
    entriesStore.setEntryFlags(entry.id, { read: next });
    if (next) feedsStore.decrementUnread(entry.feed_id);
    else {
      const feed = feedsStore.feeds.find((f) => f.id === entry.feed_id);
      if (feed) {
        feed.unread_count += 1;
        feedsStore.totalUnread += 1;
      }
    }
    try {
      await api.patchEntry(entry.id, { read: next });
    } catch (err) {
      console.error('toggle read failed', err);
    }
  }

  async function markFeedAllRead() {
    const feedId = entriesStore.feedId;
    if (typeof feedId !== 'number') return;
    entriesStore.markAllRead();
    feedsStore.setFeedUnread(feedId, 0);
    try {
      await api.markFeedAllRead(feedId);
    } catch (err) {
      console.error('mark feed read failed', err);
    }
  }

  async function fetchFullContent() {
    const entry = entriesStore.detail;
    if (!entry) return;
    if (uiStore.fullContentOverride !== null) {
      uiStore.setFullContent(null);
      return;
    }
    uiStore.setStatus('Fetching full article…');
    try {
      const res = await api.getFullContent(entry.id);
      uiStore.setFullContent(res.text);
      uiStore.setStatus('');
    } catch (err) {
      uiStore.setStatus(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function openInBrowser() {
    const url = entriesStore.detail?.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function spaceAdvance() {
    // 1. Content scroll if not at bottom
    if (uiStore.focus === 'content') {
      const scroller = getContentScroller();
      if (scroller && !scroller.isAtBottom()) {
        scroller.scrollBy(PAGE_SCROLL_PX);
        return;
      }
    }

    // 2. Move to next unread entry within current feed
    const idx = entriesStore.entries.findIndex(
      (e, i) => i > entriesStore.selectedIndex && !e.is_read
    );
    if (idx !== -1) {
      await markCurrentReadIfNeeded();
      await entriesStore.select(idx);
      uiStore.setFocus('content');
      uiStore.setFullContent(null);
      const scroller = getContentScroller();
      scroller?.scrollToTop();
      return;
    }

    // 3. Move to next feed with unread
    const currentFeedId = entriesStore.feedId;
    const startId = typeof currentFeedId === 'number' ? currentFeedId : null;
    const nextFeed = feedsStore.nextFeedWithUnread(startId);
    if (nextFeed) {
      await markCurrentReadIfNeeded();
      feedsStore.selectFeedById(nextFeed.id);
      await entriesStore.loadForFeed(nextFeed.id);
      const firstUnread = entriesStore.entries.findIndex((e) => !e.is_read);
      if (firstUnread !== -1) await entriesStore.select(firstUnread);
      uiStore.setFocus('content');
      uiStore.setFullContent(null);
      const scroller = getContentScroller();
      scroller?.scrollToTop();
    } else {
      uiStore.setStatus('No more unread entries.');
    }
  }

  async function backwardPage() {
    if (uiStore.focus === 'content') {
      const scroller = getContentScroller();
      scroller?.scrollBy(-PAGE_SCROLL_PX);
      return;
    }
    if (uiStore.focus === 'entry') {
      await entriesStore.moveBy(-PAGE_LIST_ROWS);
    } else if (uiStore.focus === 'feed') {
      feedsStore.moveBy(-PAGE_LIST_ROWS);
      await selectCurrentFeedRow();
    }
  }

  async function focusBackward() {
    if (uiStore.focus === 'content') uiStore.setFocus('entry');
    else if (uiStore.focus === 'entry') uiStore.setFocus('feed');
  }

  function focusForward() {
    if (uiStore.focus === 'feed') uiStore.setFocus('entry');
    else if (uiStore.focus === 'entry') uiStore.setFocus('content');
  }

  async function gotoFirstUnreadOfSelected() {
    // Used by Enter on feed pane / Space when focus is feed/entry
    if (uiStore.focus === 'feed') {
      const firstUnread = entriesStore.entries.findIndex((e) => !e.is_read);
      const idx = firstUnread !== -1 ? firstUnread : 0;
      if (entriesStore.entries[idx]) {
        await entriesStore.select(idx);
        uiStore.setFocus('content');
      }
    }
  }

  async function onKeyDown(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Help overlay swallow escape
    if (uiStore.helpOpen) {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        uiStore.closeHelp();
      }
      return;
    }

    const k = e.key;
    switch (k) {
      case 'j': case 'ArrowDown':
        e.preventDefault();
        if (uiStore.focus === 'content') {
          getContentScroller()?.scrollBy(80);
        } else {
          await moveDownInCurrentFocus();
        }
        break;
      case 'k': case 'ArrowUp':
        e.preventDefault();
        if (uiStore.focus === 'content') {
          getContentScroller()?.scrollBy(-80);
        } else {
          await moveUpInCurrentFocus();
        }
        break;
      case 'J':
        e.preventDefault();
        if (uiStore.focus === 'feed') { feedsStore.moveBy(PAGE_LIST_ROWS); await selectCurrentFeedRow(); }
        else if (uiStore.focus === 'entry') { await entriesStore.moveBy(PAGE_LIST_ROWS); }
        else { getContentScroller()?.scrollBy(PAGE_SCROLL_PX); }
        break;
      case 'K':
        e.preventDefault();
        if (uiStore.focus === 'feed') { feedsStore.moveBy(-PAGE_LIST_ROWS); await selectCurrentFeedRow(); }
        else if (uiStore.focus === 'entry') { await entriesStore.moveBy(-PAGE_LIST_ROWS); }
        else { getContentScroller()?.scrollBy(-PAGE_SCROLL_PX); }
        break;
      case 'g': {
        const now = Date.now();
        if (now - lastG < 500) {
          e.preventDefault();
          if (uiStore.focus === 'feed') { feedsStore.moveToTop(); await selectCurrentFeedRow(); }
          else if (uiStore.focus === 'entry') { await entriesStore.moveToTop(); }
          else { getContentScroller()?.scrollToTop(); }
          lastG = 0;
        } else {
          lastG = now;
        }
        break;
      }
      case 'G':
        e.preventDefault();
        if (uiStore.focus === 'feed') { feedsStore.moveToBottom(); await selectCurrentFeedRow(); }
        else if (uiStore.focus === 'entry') { await entriesStore.moveToBottom(); }
        else { getContentScroller()?.scrollToBottom(); }
        break;
      case 'n': {
        e.preventDefault();
        const startId = typeof entriesStore.feedId === 'number' ? entriesStore.feedId : null;
        const next = feedsStore.nextFeedWithUnread(startId);
        if (next) {
          feedsStore.selectFeedById(next.id);
          await entriesStore.loadForFeed(next.id);
        }
        break;
      }
      case 'p':
        e.preventDefault();
        await togglePin();
        break;
      case 'u':
        e.preventDefault();
        await toggleRead();
        break;
      case 'm':
        e.preventDefault();
        await markFeedAllRead();
        break;
      case 'v':
        e.preventDefault();
        openInBrowser();
        break;
      case 'e':
        e.preventDefault();
        await fetchFullContent();
        break;
      case ' ':
        e.preventDefault();
        await spaceAdvance();
        break;
      case 'b':
        e.preventDefault();
        await backwardPage();
        break;
      case 's':
        if (uiStore.focus === 'feed') {
          e.preventDefault();
          uiStore.toggleSort();
          await feedsStore.load();
        }
        break;
      case 'H':
        if (uiStore.focus === 'feed') {
          e.preventDefault();
          uiStore.cycleFilter();
          await feedsStore.load();
        }
        break;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) {
          if (uiStore.focus === 'entry') uiStore.setFocus('feed');
          else if (uiStore.focus === 'content') uiStore.setFocus('entry');
        } else {
          focusForward();
        }
        break;
      case 'Escape':
      case 'Backspace':
        e.preventDefault();
        await focusBackward();
        break;
      case 'Enter':
        if (uiStore.focus === 'feed') {
          e.preventDefault();
          const row = feedsStore.selectedRow;
          if (row?.type === 'category') {
            feedsStore.toggleCollapseSelected();
          } else {
            const fid = feedsStore.selectedFeedId;
            if (fid != null) {
              await entriesStore.loadForFeed(fid);
              await gotoFirstUnreadOfSelected();
            }
          }
        } else if (uiStore.focus === 'entry') {
          e.preventDefault();
          uiStore.setFocus('content');
        }
        break;
      case '?':
        e.preventDefault();
        uiStore.toggleHelp();
        break;
      default:
        break;
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown));
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
}
