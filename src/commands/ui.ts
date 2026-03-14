import { execSync } from 'child_process';
import { openDb } from '../db/schema.js';
import { Queries } from '../db/queries.js';
import { crawlFeed } from '../crawler/index.js';
import { createLayout } from '../ui/layout.js';
import { FeedList } from '../ui/feed-list.js';
import { EntryList } from '../ui/entry-list.js';
import { EntryView } from '../ui/entry-view.js';

export async function cmdUi(): Promise<void> {
  const db = openDb();
  const q = new Queries(db);

  const layout = createLayout();
  const { screen, feedPane, entryPane, contentPane, statusBar } = layout;

  const feedList = new FeedList(feedPane, q);
  const entryList = new EntryList(entryPane, q);
  const entryView = new EntryView(contentPane);

  // Current focus: 'feed' | 'entry' | 'content'
  let focus: 'feed' | 'entry' | 'content' = 'feed';
  let searchMode = false;

  function setStatus(msg: string): void {
    statusBar.setContent(` ${msg}`);
    screen.render();
  }

  function resetStatus(): void {
    statusBar.setContent(
      ' {bold}j/k{/bold}:move  {bold}Enter{/bold}:select  {bold}P{/bold}:pin  {bold}u{/bold}:read  {bold}v{/bold}:browser  {bold}r{/bold}:reload  {bold}/{/bold}:search  {bold}Tab{/bold}:focus  {bold}q{/bold}:quit'
    );
    screen.render();
  }

  function updateFocus(): void {
    if (focus === 'feed') {
      feedPane.focus();
    } else if (focus === 'entry') {
      entryPane.focus();
    } else {
      contentPane.focus();
    }
    screen.render();
  }

  function openSelectedEntry(): void {
    const entry = entryList.getSelected();
    if (!entry) return;
    entryList.markSelectedAsRead();
    feedList.refresh();

    const feedRecord = entry.feed_id ? q.getFeedById(entry.feed_id) : undefined;
    const entryWithFeed = { ...entry, feed_title: feedRecord?.title ?? '' };
    entryView.show(entryWithFeed);
  }

  // Tab: cycle focus
  screen.key(['tab'], () => {
    if (focus === 'feed') focus = 'entry';
    else if (focus === 'entry') focus = 'content';
    else focus = 'feed';
    updateFocus();
  });

  // Quit
  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  // Escape: exit search
  screen.key(['escape'], () => {
    if (searchMode) {
      searchMode = false;
      resetStatus();
    }
  });

  // Search
  screen.key(['/'], () => {
    if (searchMode) return;
    searchMode = true;
    setStatus('Search: ');

    // Use readline-style input via a prompt box
    const prompt = (screen as unknown as { readInput: (label: string, value: string, cb: (err: Error | null, val: string) => void) => void }).readInput;
    if (prompt) {
      prompt.call(screen, 'Search:', '', (err: Error | null, val: string) => {
        searchMode = false;
        if (err || !val) { resetStatus(); return; }
        entryList.loadSearch(val);
        focus = 'entry';
        updateFocus();
        resetStatus();
      });
    } else {
      // Fallback: simple input box
      const inputBox = (screen as unknown as { question: (label: string, cb: (err: Error | null, val: string) => void) => void }).question;
      if (inputBox) {
        inputBox.call(screen, 'Search: ', (err: Error | null, val: string) => {
          searchMode = false;
          if (err || !val) { resetStatus(); return; }
          entryList.loadSearch(val);
          focus = 'entry';
          updateFocus();
          resetStatus();
        });
      } else {
        searchMode = false;
        resetStatus();
      }
    }
  });

  // Reload current feed
  screen.key(['r'], async () => {
    const feedId = feedList.getSelectedFeedId();
    if (feedId == null || feedId === -1) return;
    setStatus(`Reloading feed #${feedId}...`);
    await crawlFeed(db, feedId);
    feedList.refresh();
    entryList.refresh();
    resetStatus();
  });

  // Reload all feeds
  screen.key(['R'], async () => {
    setStatus('Reloading all feeds...');
    await crawlFeed(db);
    feedList.refresh();
    entryList.refresh();
    resetStatus();
  });

  // ── Feed pane keys ────────────────────────────────────────────────────────

  feedPane.key(['j', 'down'], () => {
    if (focus !== 'feed') return;
    feedList.moveDown();
  });

  feedPane.key(['k', 'up'], () => {
    if (focus !== 'feed') return;
    feedList.moveUp();
  });

  feedPane.key(['enter', 'space'], () => {
    if (focus !== 'feed') return;
    const selected = feedList.getSelected();
    if (!selected) return;

    if (selected.type === 'category') {
      feedList.toggleCollapse();
    } else if (selected.type === 'pinned') {
      entryList.loadPinned();
      focus = 'entry';
      updateFocus();
    } else if (selected.type === 'feed' && selected.feed) {
      entryList.loadFeed(selected.feed.id);
      focus = 'entry';
      updateFocus();
    }
  });

  feedPane.key(['d'], () => {
    if (focus !== 'feed') return;
    const feed = feedList.getSelectedFeed();
    if (!feed) return;

    setStatus(`Delete "${feed.title}"? (y/N)`);
    screen.once('keypress', (_ch: string | undefined, key: { name: string }) => {
      if (key.name === 'y') {
        q.deleteFeed(feed.id);
        feedList.refresh();
        entryList.refresh();
        entryView.clear();
        setStatus(`Deleted: "${feed.title}"`);
        setTimeout(() => resetStatus(), 2000);
      } else {
        resetStatus();
      }
    });
  });

  // ── Entry pane keys ───────────────────────────────────────────────────────

  entryPane.key(['j', 'down'], () => {
    if (focus !== 'entry') return;
    entryList.moveDown();
    openSelectedEntry();
  });

  entryPane.key(['k', 'up'], () => {
    if (focus !== 'entry') return;
    entryList.moveUp();
    openSelectedEntry();
  });

  entryPane.key(['enter', 'space'], () => {
    if (focus !== 'entry') return;
    openSelectedEntry();
  });

  entryPane.key(['n'], () => {
    if (focus !== 'entry') return;
    const next = entryList.nextUnread();
    if (next) openSelectedEntry();
  });

  entryPane.key(['p'], () => {
    if (focus !== 'entry') return;
    const prev = entryList.prevUnread();
    if (prev) openSelectedEntry();
  });

  entryPane.key(['P'], () => {
    if (focus !== 'entry') return;
    entryList.togglePinSelected();
    feedList.refresh();
  });

  entryPane.key(['u'], () => {
    if (focus !== 'entry') return;
    entryList.toggleReadSelected();
    feedList.refresh();
  });

  entryPane.key(['m'], () => {
    if (focus !== 'entry') return;
    entryList.markAllAsRead();
    feedList.refresh();
  });

  entryPane.key(['v'], () => {
    if (focus !== 'entry') return;
    const entry = entryList.getSelected();
    if (!entry?.url) return;
    try {
      const platform = process.platform;
      const cmd =
        platform === 'darwin'
          ? `open "${entry.url}"`
          : platform === 'win32'
          ? `start "${entry.url}"`
          : `xdg-open "${entry.url}"`;
      execSync(cmd);
    } catch {
      setStatus(`Could not open: ${entry.url}`);
      setTimeout(() => resetStatus(), 2000);
    }
  });

  // ── Content pane keys ─────────────────────────────────────────────────────

  contentPane.key(['j', 'down'], () => {
    if (focus !== 'content') return;
    entryView.scrollDown();
  });

  contentPane.key(['k', 'up'], () => {
    if (focus !== 'content') return;
    entryView.scrollUp();
  });

  // Initial focus
  updateFocus();
  feedList.refresh();
  resetStatus();
  screen.render();
}
