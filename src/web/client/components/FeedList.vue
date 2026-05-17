<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useFeedsStore } from '../stores/feeds';
import { useUiStore } from '../stores/ui';

const feedsStore = useFeedsStore();
const uiStore = useUiStore();

const listEl = ref<HTMLElement | null>(null);

const totalUnreadLabel = computed(() =>
  feedsStore.totalUnread > 0 ? `(${feedsStore.totalUnread})` : ''
);

const filterBadge = computed(() => {
  if (uiStore.filter === 'active') return { text: 'active', color: 'var(--accent-red)' };
  if (uiStore.filter === 'unread') return { text: 'unread', color: 'var(--accent-yellow)' };
  return { text: 'all', color: 'var(--fg-muted)' };
});

function feedTitle(feed: { title: string; url: string }): string {
  if (feed.title) return feed.title;
  try { return new URL(feed.url).hostname; } catch { return feed.url; }
}

function selectByIndex(idx: number) {
  feedsStore.selectedIndex = idx;
  uiStore.setFocus('feed');
}

watch(
  () => feedsStore.selectedIndex,
  async () => {
    await nextTick();
    const el = listEl.value?.querySelector<HTMLElement>(`[data-row="${feedsStore.selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }
);
</script>

<template>
  <section
    class="pane"
    :class="{ focused: uiStore.focus === 'feed' }"
    @click="uiStore.setFocus('feed')"
  >
    <header class="pane-header">
      <span class="pane-title">Feeds</span>
      <span v-if="totalUnreadLabel" class="badge badge-unread">{{ totalUnreadLabel }}</span>
      <span class="badge badge-meta">[{{ uiStore.sort }}]</span>
      <span
        v-if="filterBadge.text !== 'all'"
        class="badge"
        :style="{ color: filterBadge.color }"
      >{{ filterBadge.text }}</span>
    </header>

    <div ref="listEl" class="pane-body">
      <div
        v-for="(row, idx) in feedsStore.rows"
        :key="`${row.type}-${idx}-${row.feed?.id ?? row.category?.id ?? 'pinned'}`"
        :data-row="idx"
        class="row"
        :class="{ selected: idx === feedsStore.selectedIndex }"
        :style="{ paddingLeft: `${8 + row.indent * 14}px` }"
        @click="selectByIndex(idx)"
      >
        <template v-if="row.type === 'pinned'">
          <span class="pin-row">★ Pinned</span>
        </template>
        <template v-else-if="row.type === 'category' && row.category">
          <span class="category">
            <span class="caret">{{ row.collapsed ? '▶' : '▼' }}</span>
            <span>{{ row.category.name }}</span>
          </span>
        </template>
        <template v-else-if="row.type === 'feed' && row.feed">
          <span class="feed-row">
            <span v-if="row.feed.next_retry_at != null" class="error-mark">⏸</span>
            <span v-else-if="row.feed.error_count >= 5" class="error-mark">⚠</span>
            <span class="feed-title" :class="{ dim: row.feed.unread_count === 0 }">{{ feedTitle(row.feed) }}</span>
            <span v-if="row.feed.unread_count > 0" class="feed-unread">({{ row.feed.unread_count }})</span>
          </span>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pane {
  background: var(--bg-pane);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.pane.focused {
  border-color: var(--border-focus);
}
.pane-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-muted);
}
.pane-title {
  color: var(--fg);
  font-weight: 600;
}
.badge {
  font-size: 11px;
}
.badge-unread {
  color: var(--accent-blue);
}
.badge-meta {
  color: var(--fg-dim);
}
.pane-body {
  flex: 1;
  overflow-y: auto;
  font-family: var(--font-mono);
  padding: 4px 0;
}
.row {
  padding: 2px 8px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}
.row.selected {
  background: var(--bg-row-selected);
}
.row:hover {
  background: var(--bg-row-cursor);
}
.pin-row {
  color: var(--accent-yellow);
}
.category {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}
.caret {
  color: var(--fg-muted);
  width: 10px;
  display: inline-block;
}
.feed-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.feed-title.dim {
  color: var(--fg-dim);
}
.feed-unread {
  color: var(--accent-blue);
  font-size: 11px;
}
.error-mark {
  color: var(--accent-red);
}
</style>
