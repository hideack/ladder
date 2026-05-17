<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import FeedList from './components/FeedList.vue';
import EntryList from './components/EntryList.vue';
import EntryView from './components/EntryView.vue';
import HelpOverlay from './components/HelpOverlay.vue';
import { useFeedsStore } from './stores/feeds';
import { useEntriesStore } from './stores/entries';
import { useUiStore } from './stores/ui';
import { useKeyboard, type ContentScroller } from './composables/useKeyboard';
import { useSSE } from './composables/useSSE';

const feedsStore = useFeedsStore();
const entriesStore = useEntriesStore();
const uiStore = useUiStore();

const entryViewRef = ref<InstanceType<typeof EntryView> | null>(null);
const getScroller = (): ContentScroller | null => entryViewRef.value as ContentScroller | null;

useKeyboard(getScroller);

useSSE(async (event) => {
  if (event.type === 'crawl-done') {
    // Refresh feeds list to reflect unread count changes.
    await feedsStore.load();
    // If the current feed was updated, reload its entries (preserving selection if possible).
    if (typeof entriesStore.feedId === 'number' && event.feedIds.includes(entriesStore.feedId)) {
      const currentEntryId = entriesStore.selectedEntry?.id ?? null;
      await entriesStore.loadForFeed(entriesStore.feedId);
      if (currentEntryId != null) {
        const idx = entriesStore.entries.findIndex((e) => e.id === currentEntryId);
        if (idx !== -1) await entriesStore.select(idx);
      }
    }
  } else if (event.type === 'feed-updated') {
    feedsStore.setFeedUnread(event.feedId, event.unreadCount);
  }
});

onMounted(async () => {
  await feedsStore.load();
  // Auto-load entries for the first selectable feed.
  const firstFeed = feedsStore.rows.find((r) => r.type === 'feed' && r.feed);
  if (firstFeed?.feed) {
    feedsStore.selectFeedById(firstFeed.feed.id);
    await entriesStore.loadForFeed(firstFeed.feed.id);
  }
});

// Auto-clear transient status messages after 4s.
watch(
  () => uiStore.statusMessage,
  (msg) => {
    if (!msg) return;
    setTimeout(() => {
      if (uiStore.statusMessage === msg) uiStore.setStatus('');
    }, 4000);
  }
);

const headerLabel = computed(() => {
  const unread = feedsStore.totalUnread;
  return unread > 0 ? `ladder — unread ${unread}` : 'ladder';
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <span class="title">{{ headerLabel }}</span>
      <span class="hint">
        j/k:move · Space:read-on · p:pin · v:open · e:full · ?:help
      </span>
    </header>
    <main class="panes">
      <div class="col col-feeds"><FeedList /></div>
      <div class="col col-entries"><EntryList /></div>
      <div class="col col-content"><EntryView ref="entryViewRef" /></div>
    </main>
    <footer class="statusbar">
      <span v-if="uiStore.statusMessage">{{ uiStore.statusMessage }}</span>
      <span v-else>Focus: {{ uiStore.focus }} · Filter: {{ uiStore.filter }} · Sort: {{ uiStore.sort }}</span>
    </footer>
    <HelpOverlay />
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100%;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: var(--bg-pane);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 12px;
}
.title {
  font-weight: 700;
  color: var(--fg);
}
.hint {
  color: var(--fg-muted);
}
.panes {
  display: grid;
  grid-template-columns: 25% 35% 40%;
  gap: 0;
  min-height: 0;
}
.col {
  min-width: 0;
  min-height: 0;
  display: flex;
}
.col > * {
  flex: 1;
}
.statusbar {
  padding: 4px 12px;
  background: var(--bg-pane);
  border-top: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted);
}
</style>
