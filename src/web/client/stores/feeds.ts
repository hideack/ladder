import { defineStore } from 'pinia';
import { api } from '../composables/useApi';
import { useUiStore } from './ui';
import type { ApiCategory, ApiFeed } from '@shared/types';

export type FeedRowType = 'pinned' | 'category' | 'feed';
export interface FeedRow {
  type: FeedRowType;
  indent: number;
  feed?: ApiFeed;
  category?: ApiCategory;
  collapsed?: boolean;
}

interface State {
  feeds: ApiFeed[];
  categories: ApiCategory[];
  totalUnread: number;
  selectedIndex: number;
  collapsedCategories: Set<number>;
  loading: boolean;
}

export const useFeedsStore = defineStore('feeds', {
  state: (): State => ({
    feeds: [],
    categories: [],
    totalUnread: 0,
    selectedIndex: 0,
    collapsedCategories: new Set(),
    loading: false,
  }),
  getters: {
    rows(state): FeedRow[] {
      const rows: FeedRow[] = [];
      rows.push({ type: 'pinned', indent: 0 });

      const roots = state.categories.filter((c) => c.parent_id == null);
      const children = state.categories.filter((c) => c.parent_id != null);

      for (const cat of roots) {
        const collapsed = state.collapsedCategories.has(cat.id);
        rows.push({ type: 'category', category: cat, collapsed, indent: 0 });
        if (collapsed) continue;

        const subs = children.filter((c) => c.parent_id === cat.id);
        for (const sub of subs) {
          const subCollapsed = state.collapsedCategories.has(sub.id);
          rows.push({ type: 'category', category: sub, collapsed: subCollapsed, indent: 1 });
          if (subCollapsed) continue;
          for (const feed of state.feeds.filter((f) => f.category_id === sub.id)) {
            rows.push({ type: 'feed', feed, indent: 2 });
          }
        }
        for (const feed of state.feeds.filter((f) => f.category_id === cat.id)) {
          rows.push({ type: 'feed', feed, indent: 1 });
        }
      }

      for (const feed of state.feeds.filter((f) => f.category_id == null)) {
        rows.push({ type: 'feed', feed, indent: 0 });
      }

      return rows;
    },
    selectedRow(): FeedRow | undefined {
      return this.rows[this.selectedIndex];
    },
    selectedFeedId(): number | 'pinned' | null {
      const row = this.selectedRow;
      if (!row) return null;
      if (row.type === 'pinned') return 'pinned';
      if (row.type === 'feed' && row.feed) return row.feed.id;
      return null;
    },
  },
  actions: {
    async load() {
      const ui = useUiStore();
      this.loading = true;
      try {
        const res = await api.getFeeds(ui.filter, ui.sort);
        const prevSelected = this.selectedRow;
        const prevFeedId = prevSelected?.type === 'feed' ? prevSelected.feed?.id : null;
        const prevType = prevSelected?.type;

        this.feeds = res.feeds;
        this.categories = res.categories;
        this.totalUnread = res.total_unread;

        if (prevFeedId != null) {
          const idx = this.rows.findIndex((r) => r.type === 'feed' && r.feed?.id === prevFeedId);
          if (idx !== -1) this.selectedIndex = idx;
          else this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.rows.length - 1));
        } else if (prevType === 'pinned') {
          // pinned stays at index 0
          this.selectedIndex = 0;
        } else {
          this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.rows.length - 1));
        }
      } finally {
        this.loading = false;
      }
    },
    moveDown() {
      if (this.selectedIndex < this.rows.length - 1) this.selectedIndex++;
    },
    moveUp() {
      if (this.selectedIndex > 0) this.selectedIndex--;
    },
    moveBy(delta: number) {
      this.selectedIndex = Math.max(0, Math.min(this.rows.length - 1, this.selectedIndex + delta));
    },
    moveToTop() {
      this.selectedIndex = 0;
    },
    moveToBottom() {
      this.selectedIndex = Math.max(0, this.rows.length - 1);
    },
    selectFeedById(feedId: number) {
      const idx = this.rows.findIndex((r) => r.type === 'feed' && r.feed?.id === feedId);
      if (idx !== -1) this.selectedIndex = idx;
    },
    toggleCollapseSelected() {
      const row = this.selectedRow;
      if (row?.type === 'category' && row.category) {
        if (this.collapsedCategories.has(row.category.id)) {
          this.collapsedCategories.delete(row.category.id);
        } else {
          this.collapsedCategories.add(row.category.id);
        }
      }
    },
    nextFeedWithUnread(afterFeedId: number | null): ApiFeed | null {
      const feedRows = this.rows.filter((r): r is FeedRow & { feed: ApiFeed } => r.type === 'feed' && r.feed != null);
      if (afterFeedId == null) {
        return feedRows.find((r) => r.feed.unread_count > 0)?.feed ?? null;
      }
      const idx = feedRows.findIndex((r) => r.feed.id === afterFeedId);
      const start = idx === -1 ? 0 : idx + 1;
      for (let i = start; i < feedRows.length; i++) {
        if (feedRows[i].feed.unread_count > 0) return feedRows[i].feed;
      }
      for (let i = 0; i < start; i++) {
        if (feedRows[i].feed.unread_count > 0) return feedRows[i].feed;
      }
      return null;
    },
    decrementUnread(feedId: number) {
      const feed = this.feeds.find((f) => f.id === feedId);
      if (feed && feed.unread_count > 0) {
        feed.unread_count -= 1;
        this.totalUnread = Math.max(0, this.totalUnread - 1);
      }
    },
    setFeedUnread(feedId: number, count: number) {
      const feed = this.feeds.find((f) => f.id === feedId);
      if (feed) {
        const diff = count - feed.unread_count;
        feed.unread_count = count;
        this.totalUnread = Math.max(0, this.totalUnread + diff);
      }
    },
  },
});
