<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useEntriesStore } from '../stores/entries';
import { useFeedsStore } from '../stores/feeds';
import { useUiStore } from '../stores/ui';
import { api } from '../composables/useApi';
import { formatDateTime } from '../utils/format';
import { renderHtml } from '../utils/sanitize';
import PodcastPlayer from './PodcastPlayer.vue';

// Wait this long after an entry loads before checking if it fully fits in the
// viewport. Buys time for late-loading images to reflow the layout — otherwise
// short-looking content might auto-mark before its images arrive.
const SHORT_CONTENT_DELAY_MS = 1500;

const entriesStore = useEntriesStore();
const feedsStore = useFeedsStore();
const uiStore = useUiStore();

const bodyEl = ref<HTMLElement | null>(null);
let autoReadMarkedId: number | null = null;
let shortContentTimer: number | null = null;

const html = computed(() => renderHtml(entriesStore.detail?.content ?? ''));

function isAtBottom(): boolean {
  if (!bodyEl.value) return false;
  const { scrollTop, scrollHeight, clientHeight } = bodyEl.value;
  return scrollTop + clientHeight >= scrollHeight - 2;
}

async function markCurrentAsRead() {
  const entry = entriesStore.detail;
  if (!entry || entry.is_read) return;
  if (autoReadMarkedId === entry.id) return;
  autoReadMarkedId = entry.id;
  entriesStore.setEntryFlags(entry.id, { read: true });
  feedsStore.decrementUnread(entry.feed_id);
  try {
    await api.patchEntry(entry.id, { read: true });
  } catch (err) {
    console.error('auto mark-as-read failed', err);
    autoReadMarkedId = null;
  }
}

function onBodyScroll() {
  if (isAtBottom()) markCurrentAsRead();
}

// When the entry changes: reset scroll, then schedule a "still fits" check.
watch(
  () => entriesStore.detail?.id,
  async (id) => {
    if (bodyEl.value) bodyEl.value.scrollTop = 0;
    if (shortContentTimer) {
      clearTimeout(shortContentTimer);
      shortContentTimer = null;
    }
    if (id == null) return;
    await nextTick();
    shortContentTimer = window.setTimeout(() => {
      shortContentTimer = null;
      if (isAtBottom()) markCurrentAsRead();
    }, SHORT_CONTENT_DELAY_MS);
  }
);

onUnmounted(() => {
  if (shortContentTimer) clearTimeout(shortContentTimer);
});

defineExpose({
  scrollBy(delta: number) {
    if (bodyEl.value) bodyEl.value.scrollTop += delta;
  },
  scrollToTop() {
    if (bodyEl.value) bodyEl.value.scrollTop = 0;
  },
  scrollToBottom() {
    if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight;
  },
  isAtBottom,
});
</script>

<template>
  <section
    class="pane"
    :class="{ focused: uiStore.focus === 'content' }"
    @click="uiStore.setFocus('content')"
  >
    <header class="pane-header">
      <span class="pane-title">Content</span>
      <span v-if="entriesStore.detail" class="badge-meta">{{ entriesStore.detail.feed_title }}</span>
    </header>

    <div ref="bodyEl" class="pane-body" @scroll.passive="onBodyScroll">
      <template v-if="entriesStore.detailLoading && !entriesStore.detail">
        <div class="loading">Loading…</div>
      </template>
      <template v-else-if="!entriesStore.detail">
        <div class="empty">Select an entry to read</div>
      </template>
      <template v-else>
        <article>
          <h1 class="title">{{ entriesStore.detail.title || '(no title)' }}</h1>
          <div class="meta">
            <a v-if="entriesStore.detail.url" :href="entriesStore.detail.url" target="_blank" rel="noopener noreferrer">
              {{ entriesStore.detail.url }}
            </a>
            <span v-if="entriesStore.detail.author">· {{ entriesStore.detail.author }}</span>
            <span v-if="entriesStore.detail.published_at">· {{ formatDateTime(entriesStore.detail.published_at) }}</span>
            <span v-if="entriesStore.detail.is_pinned" class="pin">· ★ pinned</span>
          </div>

          <PodcastPlayer
            v-if="entriesStore.detail.enclosure_url"
            :src="entriesStore.detail.enclosure_url"
            :mime-type="entriesStore.detail.enclosure_type"
          />

          <div v-if="uiStore.fullContentOverride !== null" class="full-content">
            <div class="full-banner">[Fetched full article — press e to revert]</div>
            <pre>{{ uiStore.fullContentOverride }}</pre>
          </div>
          <div v-else class="content" v-html="html" />
        </article>
      </template>
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
.badge-meta {
  font-size: 11px;
  color: var(--fg-dim);
}
.pane-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px;
  scroll-behavior: smooth;
}
.loading, .empty {
  padding: 30px;
  color: var(--fg-muted);
  text-align: center;
}
.title {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 8px;
  line-height: 1.35;
}
.meta {
  font-size: 12px;
  color: var(--fg-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
  word-break: break-all;
}
.meta .pin {
  color: var(--accent-yellow);
}
.content :deep(p),
.content :deep(li),
.content :deep(blockquote) {
  line-height: 1.7;
}
.content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}
.content :deep(pre) {
  background: var(--bg-pane-focus);
  padding: 10px;
  border-radius: 4px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 12px;
}
.content :deep(code) {
  background: var(--bg-pane-focus);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.content :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 10px;
  margin-left: 0;
  color: var(--fg-muted);
}
.content :deep(a) {
  color: var(--link);
}
.full-content .full-banner {
  background: var(--bg-pane-focus);
  color: var(--accent-yellow);
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  margin-bottom: 10px;
  font-family: var(--font-mono);
}
.full-content pre {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
}
</style>
