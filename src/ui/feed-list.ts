import blessed from 'neo-blessed';
import { Queries, Feed, Category } from '../db/queries.js';

export type SortMode = 'unread' | 'latest';

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
  private selectedIndex = 0;
  private viewTop = 0;
  private collapsedCategories = new Set<number>();
  private q: Queries;

  sortMode: SortMode = 'latest';
  hideNoUnread = false;

  constructor(
    private pane: blessed.Widgets.BoxElement,
    q: Queries
  ) {
    this.q = q;
    this.refresh();
  }

  refresh(): void {
    const feeds = this.q.getAllFeedsWithLatest();
    const categories = this.q.getCategories();
    this.items = this.buildItems(feeds, categories);
    this.render();
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

    // 未読フィルタ適用
    const visibleFeeds = this.hideNoUnread
      ? feeds.filter((f) => f.unread_count > 0)
      : feeds;

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
      const errorMark = feed.error_count >= 5 ? '{red-fg}⚠{/red-fg} ' : '';
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
    const lines = this.items.map((item, i) => this.formatItem(item, i));
    this.pane.setContent(lines.join('\n'));

    // 端に達したときだけスクロール（カーソルは自然に動く）
    const innerHeight = Math.max(1, (this.pane.height as number) - 2);
    if (this.selectedIndex < this.viewTop) {
      this.viewTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.viewTop + innerHeight) {
      this.viewTop = this.selectedIndex - innerHeight + 1;
    }
    this.pane.scrollTo(this.viewTop);

    // ラベル: 未読合計 + 現在のソート/フィルタ状態
    const feeds = this.q.getAllFeeds();
    const totalUnread = feeds.reduce((sum, f) => sum + f.unread_count, 0);
    const sortLabel = this.sortMode === 'unread' ? 'unread' : 'latest';
    const filterLabel = this.hideNoUnread ? ' {red-fg}H{/red-fg}' : '';
    const unreadLabel = totalUnread > 0 ? ` {blue-fg}(${totalUnread}){/blue-fg}` : '';
    this.pane.setLabel(` Feeds${unreadLabel} {gray-fg}[${sortLabel}]${filterLabel}{/gray-fg} `);

    this.pane.screen.render();
  }

  toggleSort(): void {
    this.sortMode = this.sortMode === 'unread' ? 'latest' : 'unread';
    this.refresh();
  }

  toggleHideNoUnread(): void {
    this.hideNoUnread = !this.hideNoUnread;
    this.selectedIndex = 0;
    this.viewTop = 0;
    this.refresh();
  }

  moveDown(): void {
    if (this.selectedIndex < this.items.length - 1) {
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

  getSelected(): FeedListItem | undefined {
    return this.items[this.selectedIndex];
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
}
