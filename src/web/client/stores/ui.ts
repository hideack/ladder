import { defineStore } from 'pinia';

export type PaneFocus = 'feed' | 'entry' | 'content';

export const useUiStore = defineStore('ui', {
  state: () => ({
    focus: 'feed' as PaneFocus,
    filter: 'active' as 'active' | 'unread' | 'all',
    sort: 'latest' as 'unread' | 'latest',
    helpOpen: false,
    fullContentOverride: null as string | null,
    statusMessage: '' as string,
  }),
  actions: {
    setFocus(focus: PaneFocus) {
      this.focus = focus;
    },
    cycleFilter() {
      const next = { active: 'unread', unread: 'all', all: 'active' } as const;
      this.filter = next[this.filter];
    },
    toggleSort() {
      this.sort = this.sort === 'unread' ? 'latest' : 'unread';
    },
    toggleHelp() {
      this.helpOpen = !this.helpOpen;
    },
    closeHelp() {
      this.helpOpen = false;
    },
    setFullContent(text: string | null) {
      this.fullContentOverride = text;
    },
    setStatus(message: string) {
      this.statusMessage = message;
    },
  },
});
