import blessed from 'neo-blessed';
import { Queries, Feed, Category } from '../db/queries.js';

export type SortMode = 'unread' | 'latest';
export type FilterMode = 'active' | 'unread' | 'all';

const STALE_THRESHOLD_SEC = 180 * 24 * 60 * 60; // 180 days

export interface FeedListItem {
  type: 'category' | 'feed' | 'pinned';
  feed?: Feed & { latest_entry_at?: number | null };
  category?: Category;
  categoryId?: number;
  collapsed?: boolean;
  indent: number;
}

export class FeedList {
  private items: FeedListItem[] = [];
  private searchItems: FeedListItem[] | null = null;
  private searchQuery: string | null = null;
  private selectedIndex = 0;
  private viewTop = 0;
  private collapsedCategories = new Set<number>();
  private q: Queries;
  // Space キーで読み進め中のフィードID。unread_count が 0 になっても items から消さない
  private keepVisibleFeedId: number | null = null;

  sortMode: SortMode = 'latest';
  filterMode: FilterMode = 'active';

  private get displayItems(): FeedListItem[] {
    return this.searchItems ?? this.items;
  }

  constructor(
    private pane: blessed.Widgets.BoxElement,
    q: Queries,
    initialFilterMode?: FilterMode
  ) {
    this.q = q;
    if (initialFilterMode) this.filterMode = initialFilterMode;
    this.refresh();
  }

  refresh(): void {
    // 現在選択中のアイテムを ID で記録しておく（並び替え・フィルタ変化後も復元するため）
    const currentItem = this.displayItems[this.selectedIndex];
    const selectedFeedId = currentItem?.type === 'feed' ? currentItem.feed?.id : undefined;
    const selectedCatId = currentItem?.type === 'category' ? currentItem.categoryId : undefined;

    const feeds = this.q.getAllFeedsWithLatest();
    const categories = this.q.getCategories();
    this.items = this.buildItems(feeds, categories);

    // ID でもとの選択アイテムを探して復元する
    if (selectedFeedId != null) {
      const idx = this.displayItems.findIndex(
        (item) => item.type === 'feed' && item.feed?.id === selectedFeedId
      );
      this.selectedIndex = idx !== -1 ? idx : Math.min(this.selectedIndex, Math.max(0, this.displayItems.length - 1));
    } else if (selectedCatId != null) {
      const idx = this.displayItems.findIndex(
        (item) => item.type === 'category' && item.categoryId === selectedCatId
      );
      this.selectedIndex = idx !== -1 ? idx : Math.min(this.selectedIndex, Math.max(0, this.displayItems.length - 1));
    } else {
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.displayItems.length - 1));
    }
    this.render();
  }

  filterByQuery(query: string): void {
    this.searchQuery = query;
    const q = query.toLowerCase();
    const feeds = this.q.getAllFeedsWithLatest();
    const matched = feeds.filter((f) => {
      const title = (f.title || '').toLowerCase();
      try {
        const hostname = new URL(f.url).hostname.toLowerCase();
        return title.includes(q) || hostname.includes(q);
      } catch {
        return title.includes(q);
      }
    });
    const sorted = this.sortFeeds(matched);
    this.searchItems = sorted.map((feed) => ({ type: 'feed' as const, feed, indent: 0 }));
    this.selectedIndex = 0;
    this.viewTop = 0;
    this.render();
  }

  clearSearch(): void {
    this.searchQuery = null;
    this.searchItems = null;
    this.selectedIndex = 0;
    this.viewTop = 0;
    this.refresh();
  }

  private sortFeeds<T extends Feed & { latest_entry_at?: number | null }>(feeds: T[]): T[] {
    if (this.sortMode === 'unread') {
      return [...feeds].sort((a, b) => b.unread_count - a.unread_count);
    } else {
      return [...feeds].sort((a, b) => (b.latest_entry_at ?? 0) - (a.latest_entry_at ?? 0));
    }
  }

  private buildItems(
    feeds: Array<Feed & { latest_entry_at: number | null }>,
    categories: Category[]
  ): FeedListItem[] {
    const items: FeedListItem[] = [];

    // フィルタ適用
    const now = Math.floor(Date.now() / 1000);
    const visibleFeeds = feeds.filter((f) => {
      // Space 読み進め中のフィードは unread_count が 0 でも常に表示する
      if (f.id === this.keepVisibleFeedId) return true;
      if (this.filterMode === 'active') {
        return f.unread_count > 0 && (f.latest_entry_at != null && now - f.latest_entry_at <= STALE_THRESHOLD_SEC);
      }
      if (this.filterMode === 'unread') {
        return f.unread_count > 0;
      }
      return true; // 'all'
    });

    // Pinned section at the top
    items.push({ type: 'pinned', indent: 0 });

    const rootCategories = categories.filter((c) => c.parent_id == null);
    const childCategories = categories.filter((c) => c.parent_id != null);

    for (const cat of rootCategories) {
      const collapsed = this.collapsedCategories.has(cat.id);
      items.push({ type: 'category', category: cat, categoryId: cat.id, collapsed, indent: 0 });

      if (!collapsed) {
        const subs = childCategories.filter((c) => c.parent_id === cat.id);
        for (const sub of subs) {
          const subCollapsed = this.collapsedCategories.has(sub.id);
          items.push({ type: 'category', category: sub, categoryId: sub.id, collapsed: subCollapsed, indent: 1 });

          if (!subCollapsed) {
            const subFeeds = this.sortFeeds(visibleFeeds.filter((f) => f.category_id === sub.id));
            for (const feed of subFeeds) {
              items.push({ type: 'feed', feed, indent: 2 });
            }
          }
        }

        const catFeeds = this.sortFeeds(visibleFeeds.filter((f) => f.category_id === cat.id));
        for (const feed of catFeeds) {
          items.push({ type: 'feed', feed, indent: 1 });
        }
      }
    }

    // 未分類
    const uncategorized = this.sortFeeds(visibleFeeds.filter((f) => f.category_id == null));
    for (const feed of uncategorized) {
      items.push({ type: 'feed', feed, indent: 0 });
    }

    return items;
  }

  private formatItem(item: FeedListItem, index: number): string {
    const selected = index === this.selectedIndex;
    const prefix = selected ? '{inverse}' : '';
    const suffix = selected ? '{/inverse}' : '';

    if (item.type === 'pinned') {
      return `${prefix}{yellow-fg}★ Pinned{/yellow-fg}${suffix}`;
    }

    if (item.type === 'category' && item.category) {
      const cat = item.category;
      const arrow = item.collapsed ? '▶' : '▼';
      const indent = '  '.repeat(item.indent);
      return `${prefix}{bold}${indent}${arrow} ${cat.name}{/bold}${suffix}`;
    }

    if (item.type === 'feed' && item.feed) {
      const feed = item.feed;
      const indent = '  '.repeat(item.indent);
      const errorMark = feed.next_retry_at != null
        ? '{red-fg}⏸{/red-fg} '
        : feed.error_count >= 5
        ? '{red-fg}⚠{/red-fg} '
        : '';
      const unreadStr =
        feed.unread_count > 0
          ? ` {blue-fg}(${feed.unread_count}){/blue-fg}`
          : '';
      let title = feed.title;
      if (!title) {
        try { title = new URL(feed.url).hostname; } catch { title = feed.url; }
      }
      const maxLen = 18 - item.indent * 2;
      const truncated = title.length > maxLen ? title.substring(0, maxLen - 1) + '…' : title;
      return `${prefix}${indent}${errorMark}${truncated}${unreadStr}${suffix}`;
    }

    return '';
  }

  render(): void {
    const displayItems = this.displayItems;
    const lines = displayItems.map((item, i) => this.formatItem(item, i));
    this.pane.setContent('');
    this.pane.setContent(lines.join('\n'));

    // 端に達したときだけスクロール（カーソルは自然に動く）
    const innerHeight = Math.max(1, (this.pane.height as number) - 2);
    if (this.selectedIndex < this.viewTop) {
      this.viewTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.viewTop + innerHeight) {
      this.viewTop = this.selectedIndex - innerHeight + 1;
    }
    this.pane.scrollTo(this.viewTop);

    // ラベル: 検索中は検索クエリを表示、通常は未読合計 + ソート/フィルタ状態
    if (this.searchQuery !== null) {
      this.pane.setLabel(` Feeds: /${this.searchQuery} `);
    } else {
      const feeds = this.q.getAllFeeds();
      const totalUnread = feeds.reduce((sum, f) => sum + f.unread_count, 0);
      const sortLabel = this.sortMode === 'unread' ? 'unread' : 'latest';
      const filterLabel =
        this.filterMode === 'active' ? ' {red-fg}active{/red-fg}' :
        this.filterMode === 'unread' ? ' {yellow-fg}unread{/yellow-fg}' : '';
      const unreadLabel = totalUnread > 0 ? ` {blue-fg}(${totalUnread}){/blue-fg}` : '';
      this.pane.setLabel(` Feeds${unreadLabel} {gray-fg}[${sortLabel}]${filterLabel}{/gray-fg} `);
    }

    this.pane.screen.render();
  }

  toggleSort(): void {
    this.sortMode = this.sortMode === 'unread' ? 'latest' : 'unread';
    this.refresh();
  }

  cycleFilter(): void {
    const next: Record<FilterMode, FilterMode> = { active: 'unread', unread: 'all', all: 'active' };
    this.filterMode = next[this.filterMode];
    this.selectedIndex = 0;
    this.viewTop = 0;
    this.refresh();
  }

  moveDown(): void {
    if (this.selectedIndex < this.displayItems.length - 1) {
      this.selectedIndex++;
      this.render();
    }
  }

  moveUp(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.render();
    }
  }

  movePageDown(): void {
    const pageSize = Math.max(1, (this.pane.height as number) - 2);
    this.selectedIndex = Math.min(this.displayItems.length - 1, this.selectedIndex + pageSize);
    this.render();
  }

  movePageUp(): void {
    const pageSize = Math.max(1, (this.pane.height as number) - 2);
    this.selectedIndex = Math.max(0, this.selectedIndex - pageSize);
    this.render();
  }

  getSelected(): FeedListItem | undefined {
    return this.displayItems[this.selectedIndex];
  }

  toggleCollapse(): void {
    const item = this.getSelected();
    if (!item) return;

    if (item.type === 'category' && item.categoryId != null) {
      if (this.collapsedCategories.has(item.categoryId)) {
        this.collapsedCategories.delete(item.categoryId);
      } else {
        this.collapsedCategories.add(item.categoryId);
      }
      this.refresh();
    }
  }

  getSelectedFeedId(): number | null {
    const item = this.getSelected();
    if (!item) return null;
    if (item.type === 'feed' && item.feed) return item.feed.id;
    if (item.type === 'pinned') return -1;
    return null;
  }

  getSelectedFeed(): Feed | null {
    const item = this.getSelected();
    if (item?.type === 'feed' && item.feed) return item.feed;
    return null;
  }

  getSelectedCategoryId(): number | null {
    const item = this.getSelected();
    if (item?.type === 'category' && item.categoryId != null) return item.categoryId;
    return null;
  }

  setKeepVisibleFeed(feedId: number | null): void {
    this.keepVisibleFeedId = feedId;
  }

  getNextFeedWithUnread(afterFeedId: number | null): (Feed & { latest_entry_at?: number | null }) | null {
    if (afterFeedId == null) {
      // 先頭から最初の未読フィードを返す
      const first = this.items.find(
        (item): item is FeedListItem & { feed: Feed & { latest_entry_at?: number | null } } =>
          item.type === 'feed' && item.feed != null && item.feed.unread_count > 0
      );
      return first?.feed ?? null;
    }

    // 現在のフィードの位置を全アイテムから探す（unread_count が0でも見つかる）
    const currentIdx = this.items.findIndex(
      (item) => item.type === 'feed' && item.feed?.id === afterFeedId
    );
    const startIdx = currentIdx === -1 ? 0 : currentIdx + 1;

    // そこより後で未読のあるフィードを探す
    for (let i = startIdx; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.type === 'feed' && item.feed && item.feed.unread_count > 0) {
        return item.feed;
      }
    }

    // 末尾まで見つからなければ先頭に折り返して再検索（ラップアラウンド）
    for (let i = 0; i < startIdx; i++) {
      const item = this.items[i];
      if (item.type === 'feed' && item.feed && item.feed.unread_count > 0) {
        return item.feed;
      }
    }

    return null;
  }

  selectFeedById(feedId: number): void {
    const idx = this.items.findIndex((item) => item.type === 'feed' && item.feed?.id === feedId);
    if (idx !== -1) {
      this.selectedIndex = idx;
      this.render();
    }
  }
}
