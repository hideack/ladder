import { execSync } from 'child_process';
import blessed from 'neo-blessed';
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
  let helpVisible = false;

  function showHelp(): void {
    if (helpVisible) return;
    helpVisible = true;

    const overlay = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 58,
      height: 28,
      border: { type: 'line' },
      label: ' Help — any key to close ',
      tags: true,
      style: {
        border: { fg: 'yellow' },
        label: { fg: 'yellow', bold: true },
        bg: 'black',
        fg: 'white',
      },
      content: [
        '',
        ' {bold}{yellow-fg}── Global ──────────────────────────────{/yellow-fg}{/bold}',
        '  {bold}Tab{/bold}        次のペインへフォーカス移動',
        '  {bold}S-Tab{/bold}      前のペインへフォーカス移動',
        '  {bold}q / C-c{/bold}   終了',
        '  {bold}r{/bold}          選択フィードをリロード',
        '  {bold}R{/bold}          全フィードをリロード',
        '  {bold}/{/bold}          タイトル検索',
        '  {bold}Escape{/bold}     検索モード解除',
        '  {bold}?{/bold}          このヘルプを表示/閉じる',
        '',
        ' {bold}{cyan-fg}── Feeds ペイン ────────────────────────{/cyan-fg}{/bold}',
        '  {bold}j / ↓{/bold}      次のフィード/カテゴリへ',
        '  {bold}k / ↑{/bold}      前のフィード/カテゴリへ',
        '  {bold}Enter/Spc{/bold}  フィード選択 / カテゴリ折りたたみ',
        '  {bold}s{/bold}          ソート切替 (未読数 ↔ 最新記事)',
        '  {bold}H{/bold}          未読なしフィードを非表示トグル',
        '  {bold}d{/bold}          フィード購読解除',
        '',
        ' {bold}{green-fg}── Entries ペイン ──────────────────────{/green-fg}{/bold}',
        '  {bold}j / ↓{/bold}      次の記事へ (自動既読)',
        '  {bold}k / ↑{/bold}      前の記事へ',
        '  {bold}n{/bold}          次の未読記事へ',
        '  {bold}p{/bold}          前の未読記事へ',
        '  {bold}P{/bold}          ピン留めトグル',
        '  {bold}u{/bold}          未読/既読トグル',
        '  {bold}m{/bold}          フィード全件既読',
        '  {bold}v{/bold}          ブラウザで開く',
        '',
      ].join('\n'),
    });

    screen.render();

    screen.once('keypress', () => {
      helpVisible = false;
      overlay.destroy();
      screen.render();
    });
  }

  function setStatus(msg: string): void {
    statusBar.setContent(` ${msg}`);
    screen.render();
  }

  function resetStatus(): void {
    statusBar.setContent(
      ' {bold}j/k{/bold}:move  {bold}Enter{/bold}:select  {bold}s{/bold}:sort  {bold}H{/bold}:hide-read  {bold}P{/bold}:pin  {bold}u{/bold}:read  {bold}v{/bold}:browser  {bold}r{/bold}:reload  {bold}/{/bold}:search  {bold}Tab/S-Tab{/bold}:focus  {bold}?{/bold}:help  {bold}q{/bold}:quit'
    );
    screen.render();
  }

  // フォーカス中ペインは白枠、非フォーカスはグレー枠
  function updateFocus(): void {
    const paneMap = { feed: feedPane, entry: entryPane, content: contentPane };
    for (const [name, pane] of Object.entries(paneMap) as [string, blessed.Widgets.BoxElement][]) {
      const active = name === focus;
      (pane.style as Record<string, unknown>).border = { fg: active ? 'white' : 'gray' };
      (pane.style as Record<string, unknown>).label  = { fg: active ? 'white' : 'gray', bold: active };
      if (active) pane.focus();
    }
    screen.render();
  }

  // 記事を既読にして右ペインに表示
  function openSelectedEntry(): void {
    const entry = entryList.getSelected();
    if (!entry) return;
    entryList.markSelectedAsRead();
    feedList.refresh();

    const feedRecord = entry.feed_id ? q.getFeedById(entry.feed_id) : undefined;
    const entryWithFeed = { ...entry, feed_title: feedRecord?.title ?? '' };
    entryView.show(entryWithFeed);
  }

  // 既読にせず右ペインにプレビュー表示
  function previewSelectedEntry(): void {
    const entry = entryList.getSelected();
    if (!entry) return;
    const feedRecord = entry.feed_id ? q.getFeedById(entry.feed_id) : undefined;
    entryView.show({ ...entry, feed_title: feedRecord?.title ?? '' });
  }

  // フィードのエントリーを読み込んで先頭をプレビュー
  function loadFeedEntries(feedId: number): void {
    entryList.loadFeed(feedId);
    previewSelectedEntry();
  }

  // Tab: cycle focus forward
  screen.key(['tab'], () => {
    if (focus === 'feed') focus = 'entry';
    else if (focus === 'entry') focus = 'content';
    else focus = 'feed';
    updateFocus();
  });

  // Shift+Tab: cycle focus backward
  screen.key(['S-tab'], () => {
    if (focus === 'feed') focus = 'content';
    else if (focus === 'content') focus = 'entry';
    else focus = 'feed';
    updateFocus();
  });

  // Help
  screen.key(['?'], () => {
    showHelp();
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
    // カーソル移動に連動してエントリーペインを更新
    const sel = feedList.getSelected();
    if (sel?.type === 'feed' && sel.feed) {
      entryList.loadFeed(sel.feed.id);
      previewSelectedEntry();
    } else if (sel?.type === 'pinned') {
      entryList.loadPinned();
      previewSelectedEntry();
    }
  });

  feedPane.key(['k', 'up'], () => {
    if (focus !== 'feed') return;
    feedList.moveUp();
    // カーソル移動に連動してエントリーペインを更新
    const sel = feedList.getSelected();
    if (sel?.type === 'feed' && sel.feed) {
      entryList.loadFeed(sel.feed.id);
      previewSelectedEntry();
    } else if (sel?.type === 'pinned') {
      entryList.loadPinned();
      previewSelectedEntry();
    }
  });

  feedPane.key(['enter', 'space'], () => {
    if (focus !== 'feed') return;
    const selected = feedList.getSelected();
    if (!selected) return;

    if (selected.type === 'category') {
      feedList.toggleCollapse();
    } else if (selected.type === 'pinned') {
      entryList.loadPinned();
      previewSelectedEntry();
      focus = 'entry';
      updateFocus();
    } else if (selected.type === 'feed' && selected.feed) {
      loadFeedEntries(selected.feed.id);
      focus = 'entry';
      updateFocus();
    }
  });

  // s: ソート切り替え（未読数 ↔ 最新記事日時）
  // s: ソート切り替えはグローバルキーで確実に捕捉
  screen.key(['s'], () => {
    if (focus !== 'feed') return;
    feedList.toggleSort();
    setStatus(`Sort: ${feedList.sortMode === 'unread' ? 'unread count' : 'latest entry'}`);
    setTimeout(() => resetStatus(), 1500);
  });

  // H: 未読なし非表示トグルもグローバルキーで確実に捕捉
  screen.key(['H'], () => {
    if (focus !== 'feed') return;
    feedList.toggleHideNoUnread();
    setStatus(`Hide no-unread: ${feedList.hideNoUnread ? 'ON' : 'OFF'}`);
    setTimeout(() => resetStatus(), 1500);
  });

  screen.key(['d'], () => {
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
