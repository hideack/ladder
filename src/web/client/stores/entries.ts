import { defineStore } from 'pinia';
import { api } from '../composables/useApi';
import type { ApiEntryDetail, ApiEntrySummary } from '@shared/types';

interface State {
  feedId: number | 'pinned' | null;
  entries: ApiEntrySummary[];
  selectedIndex: number;
  detail: ApiEntryDetail | null;
  loading: boolean;
  detailLoading: boolean;
}

export const useEntriesStore = defineStore('entries', {
  state: (): State => ({
    feedId: null,
    entries: [],
    selectedIndex: 0,
    detail: null,
    loading: false,
    detailLoading: false,
  }),
  getters: {
    selectedEntry(): ApiEntrySummary | undefined {
      return this.entries[this.selectedIndex];
    },
  },
  actions: {
    async loadForFeed(feedId: number | 'pinned') {
      this.feedId = feedId;
      this.loading = true;
      this.entries = [];
      this.selectedIndex = 0;
      this.detail = null;
      try {
        const res = await api.getEntries(feedId);
        this.entries = res.entries;
        if (this.entries.length > 0) {
          await this.loadDetail(this.entries[0].id);
        }
      } finally {
        this.loading = false;
      }
    },
    async loadDetail(entryId: number) {
      this.detailLoading = true;
      try {
        this.detail = await api.getEntry(entryId);
      } finally {
        this.detailLoading = false;
      }
    },
    async select(index: number) {
      if (index < 0 || index >= this.entries.length) return;
      this.selectedIndex = index;
      const entry = this.entries[index];
      if (entry) await this.loadDetail(entry.id);
    },
    async moveDown() {
      if (this.selectedIndex < this.entries.length - 1) {
        await this.select(this.selectedIndex + 1);
      }
    },
    async moveUp() {
      if (this.selectedIndex > 0) {
        await this.select(this.selectedIndex - 1);
      }
    },
    async moveBy(delta: number) {
      const next = Math.max(0, Math.min(this.entries.length - 1, this.selectedIndex + delta));
      if (next !== this.selectedIndex) await this.select(next);
    },
    async moveToTop() {
      if (this.entries.length > 0) await this.select(0);
    },
    async moveToBottom() {
      if (this.entries.length > 0) await this.select(this.entries.length - 1);
    },
    setEntryFlags(entryId: number, flags: { read?: boolean; pinned?: boolean }) {
      const entry = this.entries.find((e) => e.id === entryId);
      if (entry) {
        if (typeof flags.read === 'boolean') entry.is_read = flags.read;
        if (typeof flags.pinned === 'boolean') entry.is_pinned = flags.pinned;
      }
      if (this.detail?.id === entryId) {
        if (typeof flags.read === 'boolean') this.detail.is_read = flags.read;
        if (typeof flags.pinned === 'boolean') this.detail.is_pinned = flags.pinned;
      }
    },
    markAllRead() {
      for (const entry of this.entries) entry.is_read = true;
      if (this.detail) this.detail.is_read = true;
    },
  },
});
