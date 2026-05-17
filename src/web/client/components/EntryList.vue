<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useEntriesStore } from '../stores/entries';
import { useUiStore } from '../stores/ui';
import { formatRelative } from '../utils/format';

const entriesStore = useEntriesStore();
const uiStore = useUiStore();

const listEl = ref<HTMLElement | null>(null);

async function selectByIndex(idx: number) {
  await entriesStore.select(idx);
  uiStore.setFocus('entry');
  uiStore.setFullContent(null);
}

watch(
  () => entriesStore.selectedIndex,
  async () => {
    await nextTick();
    const el = listEl.value?.querySelector<HTMLElement>(`[data-entry="${entriesStore.selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }
);
</script>

<template>
  <section
    class="pane"
    :class="{ focused: uiStore.focus === 'entry' }"
    @click="uiStore.setFocus('entry')"
  >
    <header class="pane-header">
      <span class="pane-title">Entries</span>
      <span class="badge-count">{{ entriesStore.entries.length }}</span>
    </header>
    <div ref="listEl" class="pane-body">
      <div v-if="entriesStore.loading" class="loading">Loading…</div>
      <div v-else-if="entriesStore.entries.length === 0" class="empty">No entries</div>
      <div
        v-for="(entry, idx) in entriesStore.entries"
        v-else
        :key="entry.id"
        :data-entry="idx"
        class="row"
        :class="{
          selected: idx === entriesStore.selectedIndex,
          unread: !entry.is_read,
          pinned: entry.is_pinned,
        }"
        @click="selectByIndex(idx)"
      >
        <span class="marker">
          <span v-if="entry.is_pinned" class="pin">★</span>
          <span v-else-if="!entry.is_read" class="dot">●</span>
          <span v-else>&nbsp;</span>
        </span>
        <span class="title">{{ entry.title || '(no title)' }}</span>
        <span class="meta">
          <span v-if="entry.has_enclosure" class="podcast">♪</span>
          <span class="time">{{ formatRelative(entry.published_at) }}</span>
        </span>
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
  gap: 8px;
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
.badge-count {
  font-size: 11px;
}
.pane-body {
  flex: 1;
  overflow-y: auto;
  font-family: var(--font-sans);
  padding: 4px 0;
}
.loading, .empty {
  padding: 16px;
  color: var(--fg-muted);
  text-align: center;
  font-size: 12px;
}
.row {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  font-size: 13px;
}
.row.selected {
  background: var(--bg-row-selected);
}
.row:hover:not(.selected) {
  background: var(--bg-row-cursor);
}
.row.unread .title {
  font-weight: 600;
  color: var(--fg);
}
.row:not(.unread) .title {
  color: var(--fg-muted);
}
.marker {
  text-align: center;
  font-size: 10px;
  color: var(--accent-blue);
}
.marker .pin {
  color: var(--accent-yellow);
  font-size: 12px;
}
.title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--fg-dim);
}
.podcast {
  color: var(--accent-green);
}
</style>
