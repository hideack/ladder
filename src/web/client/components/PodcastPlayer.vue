<script setup lang="ts">
defineProps<{
  src: string;
  mimeType?: string | null;
}>();
</script>

<template>
  <div class="podcast-player">
    <audio controls preload="none" :src="src" :type="mimeType ?? undefined" />
    <a :href="src" target="_blank" rel="noopener noreferrer" download class="dl-link">Download MP3</a>
  </div>
</template>

<style scoped>
.podcast-player {
  background: var(--bg-pane-focus);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
audio {
  flex: 1;
  height: 32px;
}
.dl-link {
  font-size: 12px;
  color: var(--link);
}
</style>
