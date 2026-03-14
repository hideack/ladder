import blessed from 'neo-blessed';
import { Queries, Feed, Category } from '../db/queries.js';

export interface FeedListItem {
  type: 'category' | 'feed' | 'pinned';
  feed?: Feed;
  category?: Category;
  categoryId?: number;
  collapsed?: boolean;
  indent: number;
}

export class FeedList {
  private items: FeedListItem[] = [];
  private selectedIndex = 0;
  private collapsedCategories = new Set<number>();
  private q: Queries;

  constructor(
    private pane: blessed.Widgets.BoxElement,
    q: Queries
  ) {
    this.q = q;
    this.refresh();
  }

  refresh(): void {
    const feeds = this.q.getAllFeeds();
    const categories = this.q.getCategories();
    this.items = this.buildItems(feeds, categories);
    this.render();
  }

  private buildItems(feeds: Feed[], categories: Category[]): FeedListItem[] {
    const items: FeedListItem[] = [];

    const sortByUnread = (a: Feed, b: Feed) => b.unread_count - a.unread_count;

    // Pinned section at the top
    items.push({ type: 'pinned', indent: 0 });

    // Root categories
    const rootCategories = categories.filter((c) => c.parent_id == null);
    const childCategories = categories.filter((c) => c.parent_id != null);

    for (const cat of rootCategories) {
      const collapsed = this.collapsedCategories.has(cat.id);
      items.push({ type: 'category', category: cat, categoryId: cat.id, collapsed, indent: 0 });

      if (!collapsed) {
        // Sub-categories
        const subs = childCategories.filter((c) => c.parent_id === cat.id);
        for (const sub of subs) {
          const subCollapsed = this.collapsedCategories.has(sub.id);
          items.push({ type: 'category', category: sub, categoryId: sub.id, collapsed: subCollapsed, indent: 1 });

          if (!subCollapsed) {
            const subFeeds = feeds.filter((f) => f.category_id === sub.id).sort(sortByUnread);
            for (const feed of subFeeds) {
              items.push({ type: 'feed', feed, indent: 2 });
            }
          }
        }

        // Feeds in this root category (not in sub-category)
        const catFeeds = feeds.filter((f) => f.category_id === cat.id).sort(sortByUnread);
        for (const feed of catFeeds) {
          items.push({ type: 'feed', feed, indent: 1 });
        }
      }
    }

    // Uncategorized feeds — unread first
    const uncategorized = feeds.filter((f) => f.category_id == null).sort(sortByUnread);
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
      // Calculate unread in this category
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
      // タイトル未取得のときはURLのホスト名を表示
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

    // 選択行が見えるようにスクロール追従
    this.pane.scrollTo(this.selectedIndex);

    // Update label with total unread
    const feeds = this.q.getAllFeeds();
    const totalUnread = feeds.reduce((sum, f) => sum + f.unread_count, 0);
    this.pane.setLabel(` Feeds ${totalUnread > 0 ? `{blue-fg}(${totalUnread}){/blue-fg}` : ''} `);

    this.pane.screen.render();
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
    if (item.type === 'pinned') return -1; // Special: pinned section
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
