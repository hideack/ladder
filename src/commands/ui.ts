import { spawnSync } from 'child_process';
import blessed from 'neo-blessed';
import { openDb } from '../db/schema.js';
import { Queries } from '../db/queries.js';
import { crawlFeed } from '../crawler/index.js';
import { createLayout, applyLayout, LayoutMode } from '../ui/layout.js';
import { loadUiState, saveUiState } from '../ui/ui-state.js';
import { FeedList, FilterMode } from '../ui/feed-list.js';
import { EntryList } from '../ui/entry-list.js';
import { EntryView } from '../ui/entry-view.js';
import { showCategoryPicker } from '../ui/category-picker.js';
import { showCategoryManager } from '../ui/category-manager.js';

export async function cmdUi(): Promise<void> {
  const db = openDb();
  const q = new Queries(db);

  const uiState = loadUiState();

  const layout = createLayout();
  const { screen, feedPane, entryPane, contentPane, statusBar } = layout;

  const feedList = new FeedList(feedPane, q, uiState.filterMode);
  const entryList = new EntryList(entryPane, q);
  const entryView = new EntryView(contentPane);

  // Current focus: 'feed' | 'entry' | 'content'
  let focus: 'feed' | 'entry' | 'content' = 'feed';
  let searchMode = false;
  let helpVisible = false;
  let modalOpen = false;
  let layoutMode: LayoutMode = uiState.layoutMode;

  // 検索確定後の復元用状態（Esc で通常ビューに戻すために保持）
  let searchRestoreState: {
    originPane: 'feed' | 'entry' | 'content';
    feedId: number | null;
    showPinned: boolean;
    filterMode: FilterMode;
  } | null = null;

  // 前回のレイアウトを復元
  if (layoutMode !== 'horizontal') {
    applyLayout(layout, layoutMode);
  }

  function showHelp(): void {
    if (helpVisible) return;
    helpVisible = true;

    const overlay = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 58,
      height: 32,
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
        '  {bold}l{/bold}          レイアウト切替 (水平3ペイン ↔ 垂直分割)',
        '',
        ' {bold}{cyan-fg}── 全ペイン共通 ────────────────────────{/cyan-fg}{/bold}',
        '  {bold}n{/bold}          フィードカーソル 次へ',
        '  {bold}j / k{/bold}      フォーカス依存: Feedペイン→フィード移動 / 他→エントリー移動',
        '  {bold}J / K{/bold}      同上・ページ単位移動',
        '  {bold}p{/bold}          ピン留めトグル',
        '  {bold}P{/bold}          ピン一覧を全部ブラウザで開いてピン解放',
        '  {bold}Space{/bold}      未読記事を順に読む (次へ)',
        '  {bold}b{/bold}          逆方向ページ送り (前へ)',
        '  {bold}v{/bold}          ブラウザで開く',
        '',
        ' {bold}{cyan-fg}── Feeds ペイン ────────────────────────{/cyan-fg}{/bold}',
        '  {bold}↓ / ↑{/bold}      フィード・カテゴリ移動',
        '  {bold}Enter{/bold}      フィード選択 / カテゴリ折りたたみ',
        '  {bold}s{/bold}          ソート切替 (未読数 ↔ 最新記事)',
        '  {bold}H{/bold}          フィルター切替 (active→unread→all)',
        '  {bold}d{/bold}          フィード購読解除',
        '  {bold}a{/bold}          カテゴリ割り当て',
        '  {bold}C{/bold}          カテゴリマネージャー',
        '',
        ' {bold}{green-fg}── Entries ペイン ──────────────────────{/green-fg}{/bold}',
        '  {bold}↓ / ↑{/bold}      記事移動 (自動既読)',
        '  {bold}u{/bold}          未読/既読トグル',
        '  {bold}m{/bold}          フィード全件既読 → 次フィードへ',
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
      ' {bold}n{/bold}:feed-next  {bold}j/k{/bold}:move  {bold}J/K{/bold}:page  {bold}Spc/b{/bold}:read  {bold}v{/bold}:browser  {bold}p{/bold}:pin  {bold}P{/bold}:open-all-pins  {bold}a{/bold}:category  {bold}C{/bold}:cat-mgr  {bold}l{/bold}:layout  {bold}/{/bold}:search  {bold}?{/bold}:help  {bold}q{/bold}:quit'
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

  // Escape: 検索確定後の絞り込み状態を解除して通常ビューに戻す
  screen.key(['escape'], () => {
    if (searchMode || modalOpen) return; // 検索入力中・モーダル中は onKeypress 側で処理
    if (searchRestoreState === null) return;
    const { originPane, feedId, showPinned, filterMode } = searchRestoreState;
    searchRestoreState = null;
    feedList.filterMode = filterMode;
    feedList.clearSearch();
    if (originPane !== 'feed') {
      if (feedId != null) {
        entryList.loadFeed(feedId);
      } else if (showPinned) {
        entryList.loadPinned();
      }
    }
  });

  // Tab: cycle focus forward
  screen.key(['tab'], () => {
    if (searchMode || modalOpen) return;
    if (focus === 'feed') focus = 'entry';
    else if (focus === 'entry') focus = 'content';
    else focus = 'feed';
    updateFocus();
  });

  // Shift+Tab: cycle focus backward
  screen.key(['S-tab'], () => {
    if (searchMode || modalOpen) return;
    if (focus === 'feed') focus = 'content';
    else if (focus === 'content') focus = 'entry';
    else focus = 'feed';
    updateFocus();
  });

  // Help
  screen.key(['?'], () => {
    if (searchMode || modalOpen) return;
    showHelp();
  });

  // l: レイアウト切替 (水平3ペイン ↔ 左フィード+右上下分割)
  screen.key(['l'], () => {
    if (searchMode || modalOpen) return;
    layoutMode = layoutMode === 'horizontal' ? 'vertical' : 'horizontal';
    applyLayout(layout, layoutMode);
    saveUiState({ layoutMode, filterMode: feedList.filterMode });
    const label = layoutMode === 'horizontal' ? '水平3ペイン' : '垂直分割';
    setStatus(`Layout: ${label}`);
    screen.render();
    setTimeout(() => resetStatus(), 1500);
  });

  // Quit
  screen.key(['q', 'C-c'], () => {
    if (searchMode || modalOpen) return;
    screen.destroy();
    process.exit(0);
  });

  // Incremental Search
  screen.key(['/'], () => {
    if (searchMode || modalOpen) return;
    searchMode = true;
    let query = '';
    const searchOriginPane = focus;

    // 検索開始前の状態を保存（Escape 時に復元するため）
    const priorFeedId = entryList.getCurrentFeedId();
    const priorShowPinned = entryList.isShowingPinned();
    const priorFilterMode = feedList.filterMode;

    // Feeds ペイン検索中は filterMode を一時的に 'all' にして既読フィードも対象にする
    if (searchOriginPane === 'feed') {
      feedList.filterMode = 'all';
    }

    setStatus(`/ ▋`);

    function applySearch(q: string): void {
      if (searchOriginPane === 'feed') {
        feedList.filterByQuery(q);
      } else {
        if (q === '') {
          // クエリが空になったら元のビューに戻す
          if (priorFeedId != null) {
            entryList.loadFeed(priorFeedId);
          } else if (priorShowPinned) {
            entryList.loadPinned();
          }
        } else {
          entryList.loadSearch(q);
        }
      }
      setStatus(`/ ${q}▋`);
    }

    function onKeypress(ch: string, key: { name: string; sequence: string; ctrl: boolean }): void {
      if (key.name === 'enter') {
        screen.removeListener('keypress', onKeypress);
        searchMode = false;
        feedList.filterMode = priorFilterMode;
        // 検索結果をそのまま維持し、Esc で戻れるように復元情報を保存
        searchRestoreState = {
          originPane: searchOriginPane,
          feedId: priorFeedId,
          showPinned: priorShowPinned,
          filterMode: priorFilterMode,
        };
        if (searchOriginPane !== 'feed' && query.trim()) {
          focus = 'entry';
          updateFocus();
        }
        resetStatus();
        return;
      }
      if (key.name === 'escape') {
        screen.removeListener('keypress', onKeypress);
        searchMode = false;
        searchRestoreState = null;
        // filterMode を復元
        feedList.filterMode = priorFilterMode;
        // Feeds ペインの絞り込みを解除
        feedList.clearSearch();
        // Entries ペインを検索前のビューに戻す
        if (searchOriginPane !== 'feed') {
          if (priorFeedId != null) {
            entryList.loadFeed(priorFeedId);
          } else if (priorShowPinned) {
            entryList.loadPinned();
          }
        }
        resetStatus();
        return;
      }
      if (key.name === 'backspace') {
        query = query.slice(0, -1);
        applySearch(query);
        return;
      }
      if (ch && !key.ctrl && ch.length === 1) {
        query += ch;
        applySearch(query);
      }
    }

    screen.on('keypress', onKeypress);
  });

  // Reload current feed
  screen.key(['r'], async () => {
    if (searchMode || modalOpen) return;
    const feedId = feedList.getSelectedFeedId();
    if (feedId == null || feedId === -1) return;
    const feedTitle = feedList.getSelectedFeed()?.title ?? `#${feedId}`;
    setStatus(`Reloading: ${feedTitle}`);
    await crawlFeed(db, feedId, {
      onLog: () => { /* TUI内ではステータスラインに出すのでstderrへは何もしない */ },
    });
    feedList.refresh();
    entryList.refresh();
    resetStatus();
  });

  // Reload all feeds
  screen.key(['S-r'], async () => {
    if (searchMode || modalOpen) return;
    setStatus('Reloading all feeds...');
    await crawlFeed(db, undefined, {
      onProgress: (current, total, feedTitle) => {
        const pct = Math.round((current / total) * 100);
        const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
        setStatus(` [${bar}] ${current}/${total}  ${feedTitle}`);
      },
      onLog: () => { /* TUI内ではステータスラインに集約するのでstderrへは何もしない */ },
    });
    feedList.refresh();
    entryList.refresh();
    resetStatus();
  });

  // ── Feed pane keys ────────────────────────────────────────────────────────

  feedPane.key(['down'], () => {
    if (focus !== 'feed') return;
    feedList.moveDown();
    const sel = feedList.getSelected();
    if (sel?.type === 'feed' && sel.feed) {
      entryList.loadFeed(sel.feed.id);
      previewSelectedEntry();
    } else if (sel?.type === 'pinned') {
      entryList.loadPinned();
      previewSelectedEntry();
    }
  });

  feedPane.key(['up'], () => {
    if (focus !== 'feed') return;
    feedList.moveUp();
    const sel = feedList.getSelected();
    if (sel?.type === 'feed' && sel.feed) {
      entryList.loadFeed(sel.feed.id);
      previewSelectedEntry();
    } else if (sel?.type === 'pinned') {
      entryList.loadPinned();
      previewSelectedEntry();
    }
  });

  feedPane.key(['enter'], () => {
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
    if (searchMode || modalOpen || focus !== 'feed') return;
    feedList.toggleSort();
    setStatus(`Sort: ${feedList.sortMode === 'unread' ? 'unread count' : 'latest entry'}`);
    setTimeout(() => resetStatus(), 1500);
  });

  // H: フィルターモードを循環 (active → unread → all → active)
  screen.key(['S-h'], () => {
    if (searchMode || modalOpen || focus !== 'feed') return;
    feedList.cycleFilter();
    saveUiState({ layoutMode, filterMode: feedList.filterMode });
    const label =
      feedList.filterMode === 'active' ? '未読 & 180日以内' :
      feedList.filterMode === 'unread' ? '未読のみ' : 'すべて表示';
    setStatus(`Filter: ${label}`);
    setTimeout(() => resetStatus(), 1500);
  });

  screen.key(['d'], () => {
    if (searchMode || modalOpen || focus !== 'feed') return;
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

  // C (S-c): カテゴリマネージャーを開く（全ペイン共通）
  screen.key(['S-c'], () => {
    if (searchMode || modalOpen) return;
    modalOpen = true;
    showCategoryManager(screen, q, () => {
      setImmediate(() => {
        modalOpen = false;
        feedList.refresh();
        resetStatus();
      });
    });
  });

  // a: 選択中フィードにカテゴリを割り当てる（Feeds ペインのみ）
  screen.key(['a'], () => {
    if (searchMode || modalOpen || focus !== 'feed') return;
    const feed = feedList.getSelectedFeed();
    if (!feed) return;
    modalOpen = true;
    showCategoryPicker(
      screen,
      q,
      feed.category_id,
      (categoryId) => {
        q.moveFeedToCategory(feed.id, categoryId);
        setImmediate(() => {
          modalOpen = false;
          feedList.refresh();
          const catName = categoryId != null
            ? (q.getCategories().find((c) => c.id === categoryId)?.name ?? String(categoryId))
            : 'なし';
          setStatus(`カテゴリ変更: "${feed.title}" → ${catName}`);
          setTimeout(() => resetStatus(), 2000);
        });
      },
      () => {
        setImmediate(() => {
          modalOpen = false;
          resetStatus();
        });
      }
    );
  });

  // ── Entry pane keys ───────────────────────────────────────────────────────

  entryPane.key(['down'], () => {
    if (focus !== 'entry') return;
    entryList.moveDown();
    openSelectedEntry();
  });

  entryPane.key(['up'], () => {
    if (focus !== 'entry') return;
    entryList.moveUp();
    openSelectedEntry();
  });

  entryPane.key(['enter'], () => {
    if (focus !== 'entry') return;
    openSelectedEntry();
  });

  // n: フォーカスに関わらず常にフィードカーソルを次へ移動
  screen.key(['n'], () => {
    if (searchMode || modalOpen) return;
    feedList.refresh();
    feedList.moveDown();
    const sel = feedList.getSelected();
    if (sel?.type === 'feed' && sel.feed) {
      entryList.loadFeed(sel.feed.id);
      previewSelectedEntry();
    } else if (sel?.type === 'pinned') {
      entryList.loadPinned();
      previewSelectedEntry();
    }
  });

  // j/k: フォーカス依存
  //   feed ペイン → フィードカーソル移動
  //   entry / content ペイン → エントリーカーソル移動
  screen.key(['j'], () => {
    if (searchMode || modalOpen) return;
    if (focus === 'feed') {
      feedList.refresh();
      feedList.moveDown();
      const sel = feedList.getSelected();
      if (sel?.type === 'feed' && sel.feed) {
        entryList.loadFeed(sel.feed.id);
        previewSelectedEntry();
      } else if (sel?.type === 'pinned') {
        entryList.loadPinned();
        previewSelectedEntry();
      }
    } else {
      entryList.moveDown();
      openSelectedEntry();
    }
  });

  screen.key(['k'], () => {
    if (searchMode || modalOpen) return;
    if (focus === 'feed') {
      feedList.refresh();
      feedList.moveUp();
      const sel = feedList.getSelected();
      if (sel?.type === 'feed' && sel.feed) {
        entryList.loadFeed(sel.feed.id);
        previewSelectedEntry();
      } else if (sel?.type === 'pinned') {
        entryList.loadPinned();
        previewSelectedEntry();
      }
    } else {
      entryList.moveUp();
      openSelectedEntry();
    }
  });

  // J/K: ページ単位移動（フォーカス依存）
  screen.key(['S-j'], () => {
    if (searchMode || modalOpen) return;
    if (focus === 'feed') {
      feedList.movePageDown();
      const sel = feedList.getSelected();
      if (sel?.type === 'feed' && sel.feed) {
        entryList.loadFeed(sel.feed.id);
        previewSelectedEntry();
      } else if (sel?.type === 'pinned') {
        entryList.loadPinned();
        previewSelectedEntry();
      }
    } else {
      entryList.movePageDown();
      openSelectedEntry();
    }
  });

  screen.key(['S-k'], () => {
    if (searchMode || modalOpen) return;
    if (focus === 'feed') {
      feedList.movePageUp();
      const sel = feedList.getSelected();
      if (sel?.type === 'feed' && sel.feed) {
        entryList.loadFeed(sel.feed.id);
        previewSelectedEntry();
      } else if (sel?.type === 'pinned') {
        entryList.loadPinned();
        previewSelectedEntry();
      }
    } else {
      entryList.movePageUp();
      openSelectedEntry();
    }
  });

  // p: ピン留めトグル（LDR スタイル、グローバル）
  screen.key(['p'], () => {
    if (searchMode || modalOpen) return;
    const entry = entryList.getSelected();
    if (!entry) return;
    entryList.togglePinSelected();
    feedList.refresh();
    setStatus(entry.is_pinned ? 'Pinned' : 'Unpinned');
    setTimeout(() => resetStatus(), 1500);
  });

  // c: ピン留めトグル（後方互換）
  screen.key(['c'], () => {
    if (searchMode || modalOpen) return;
    const entry = entryList.getSelected();
    if (!entry) return;
    entryList.togglePinSelected();
    feedList.refresh();
    setStatus(entry.is_pinned ? 'Pinned' : 'Unpinned');
    setTimeout(() => resetStatus(), 1500);
  });

  // P (S-p): すべてのピン済み記事をブラウザで開いてピンを解放
  screen.key(['S-p'], () => {
    if (searchMode || modalOpen) return;

    const pinned = q.getPinnedEntries(100).filter((e) => e.url);
    if (pinned.length === 0) {
      setStatus('No pinned entries');
      setTimeout(() => resetStatus(), 1500);
      return;
    }

    let opened = 0;
    for (const entry of pinned) {
      if (entry.url && openUrlInBrowser(entry.url)) opened++;
    }

    q.unpinAll();
    feedList.refresh();
    entryList.loadPinned();
    setStatus(`Opened ${opened} pinned entries in browser — pins cleared`);
    setTimeout(() => resetStatus(), 3000);
  });

  entryPane.key(['u'], () => {
    if (focus !== 'entry') return;
    entryList.toggleReadSelected();
    feedList.refresh();
  });

  // m: フォーカスに関わらず選択中フィードの全記事を既読にし、次のフィードへ移動
  screen.key(['m'], () => {
    if (searchMode || modalOpen) return;
    const feedId = entryList.getCurrentFeedId();
    if (feedId == null) return;
    entryList.markAllAsRead();
    feedList.refresh(); // 既読0になったフィードが消え、カーソルが次フィードへ移動

    // 移動先のフィードをエントリー一覧にも反映
    const sel = feedList.getSelected();
    if (sel?.type === 'feed' && sel.feed) {
      entryList.loadFeed(sel.feed.id);
      previewSelectedEntry();
    } else if (sel?.type === 'pinned') {
      entryList.loadPinned();
      previewSelectedEntry();
    }

    setStatus('Marked all as read');
    setTimeout(() => resetStatus(), 1500);
  });

  // URL を検証して安全にブラウザで開く。成功時 true を返す
  function openUrlInBrowser(url: string): boolean {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return false;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }

    const platform = process.platform;
    const [cmd, args] =
      platform === 'darwin' ? ['open', [url]] :
      platform === 'win32'  ? ['cmd', ['/c', 'start', '', url]] :
                              ['xdg-open', [url]];

    const result = spawnSync(cmd, args, { stdio: 'ignore' });
    return !result.error;
  }

  function openInBrowser(): void {
    const entry = entryList.getSelected();
    if (!entry?.url) return;

    if (!openUrlInBrowser(entry.url)) {
      setStatus(`Could not open: ${entry.url}`);
      setTimeout(() => resetStatus(), 2000);
    }
  }

  // v: ブラウザで開く（どのペインからでも）
  screen.key(['v'], () => {
    if (searchMode || modalOpen) return;
    openInBrowser();
  });

  // ── Space: sequential unread reading ──────────────────────────────────────

  // コンテンツペインが先頭に達しているか判定
  function isContentAtTop(): boolean {
    const box = contentPane as unknown as { getScrollPerc(): number };
    const scrollPerc = typeof box.getScrollPerc === 'function' ? box.getScrollPerc() : 0;
    return scrollPerc <= 1;
  }

  // コンテンツペインが末端に達しているか判定
  function isContentAtBottom(): boolean {
    const box = contentPane as unknown as { getScrollPerc(): number; getScrollHeight(): number };
    const scrollH = typeof box.getScrollHeight === 'function' ? box.getScrollHeight() : 0;
    const innerH = (contentPane.height as number) - 2;
    const scrollPerc = typeof box.getScrollPerc === 'function' ? box.getScrollPerc() : 0;
    return scrollH <= innerH || scrollPerc >= 99;
  }

  // 次の未読エントリー（またはフィード）に進む
  function advanceSpaceReading(): void {
    // 現フィード内の次の未読へ
    const next = entryList.nextUnread();
    if (next) {
      openSelectedEntry();
      focus = 'content';
      updateFocus();
      return;
    }

    // 現フィードに未読なし → 次の未読フィードへ
    const currentFeedId = entryList.getCurrentFeedId();
    const nextFeed = feedList.getNextFeedWithUnread(currentFeedId);
    if (!nextFeed) {
      setStatus('No more unread entries');
      setTimeout(() => resetStatus(), 2000);
      return;
    }

    feedList.selectFeedById(nextFeed.id);
    entryList.loadFeed(nextFeed.id);
    const firstUnread = entryList.firstUnread();
    if (firstUnread) {
      openSelectedEntry();
      focus = 'content';
      updateFocus();
    }
  }

  // b: 逆方向ページ送り（端末はShift+Spaceを区別できないため b を使用）
  screen.key(['b'], () => {
    if (searchMode || modalOpen) return;

    if (focus === 'content') {
      if (!isContentAtTop()) {
        entryView.scrollPageUp();
      } else {
        // 先頭に達したら前のエントリーへ
        entryList.moveUp();
        openSelectedEntry();
      }
      return;
    }

    // コンテンツペイン以外: 前のエントリーを開いてコンテンツペインへ
    entryList.moveUp();
    openSelectedEntry();
    focus = 'content';
    updateFocus();
  });

  screen.key(['space'], () => {
    if (searchMode || modalOpen) return;
    if (focus === 'content') {
      if (!isContentAtBottom()) {
        entryView.scrollPage();
      } else {
        advanceSpaceReading();
      }
      return;
    }

    // コンテンツペイン以外: 現フィードの先頭未読を開いてコンテンツペインへ
    const sel = feedList.getSelected();
    if (sel?.type === 'feed' && sel.feed) {
      if (entryList.getCurrentFeedId() !== sel.feed.id) {
        entryList.loadFeed(sel.feed.id);
      }
      const firstUnread = entryList.firstUnread();
      if (firstUnread) {
        openSelectedEntry();
        focus = 'content';
        updateFocus();
        return;
      }
    } else if (sel?.type === 'pinned') {
      openSelectedEntry();
      focus = 'content';
      updateFocus();
      return;
    }

    // 現フィードに未読なし → 次の未読フィードへ
    advanceSpaceReading();
  });

  // ── Content pane keys ─────────────────────────────────────────────────────

  contentPane.key(['down'], () => {
    if (focus !== 'content') return;
    entryView.scrollDown();
  });

  contentPane.key(['up'], () => {
    if (focus !== 'content') return;
    entryView.scrollUp();
  });

  // Initial focus
  updateFocus();
  feedList.refresh();
  resetStatus();
  screen.render();
}
