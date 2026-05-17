<script setup lang="ts">
import { useUiStore } from '../stores/ui';
const uiStore = useUiStore();

const sections: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Navigation',
    items: [
      ['j / k / ↓ / ↑', 'Move cursor (auto-mark as read in Entries)'],
      ['J / K',         'Page down / up'],
      ['gg / G',        'Jump to top / bottom'],
      ['n',             'Next feed with unread'],
      ['Tab / Shift+Tab', 'Cycle pane focus'],
      ['Esc / Backspace', 'Focus back (Content → Entry → Feed)'],
      ['Space',         'Read on (scroll → next entry → next feed)'],
      ['b',             'Scroll up one page'],
    ],
  },
  {
    title: 'Actions',
    items: [
      ['u',  'Toggle read / unread'],
      ['p',  'Toggle pin'],
      ['m',  'Mark entire feed as read'],
      ['v',  'Open entry in browser'],
      ['e',  'Fetch full article (toggle)'],
      ['Enter', 'Open / collapse / select'],
    ],
  },
  {
    title: 'View',
    items: [
      ['s',  'Toggle sort (unread ↔ latest)'],
      ['H',  'Cycle filter (active → unread → all)'],
      ['?',  'Toggle help (this overlay)'],
    ],
  },
];
</script>

<template>
  <div v-if="uiStore.helpOpen" class="overlay" @click.self="uiStore.closeHelp()">
    <div class="dialog">
      <header class="dialog-header">
        <span>Keyboard Shortcuts</span>
        <button class="close" @click="uiStore.closeHelp()">×</button>
      </header>
      <div class="grid">
        <section v-for="sec in sections" :key="sec.title">
          <h3>{{ sec.title }}</h3>
          <dl>
            <template v-for="[key, desc] in sec.items" :key="key">
              <dt>{{ key }}</dt>
              <dd>{{ desc }}</dd>
            </template>
          </dl>
        </section>
      </div>
      <footer class="dialog-footer">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  background: var(--bg-pane);
  border: 1px solid var(--border-focus);
  border-radius: 6px;
  padding: 20px;
  max-width: 720px;
  max-height: 80vh;
  overflow-y: auto;
  width: 90%;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  font-size: 14px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 10px;
  margin-bottom: 14px;
}
.close {
  background: none;
  border: none;
  color: var(--fg);
  font-size: 20px;
  cursor: pointer;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 18px;
}
h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-muted);
  margin: 0 0 8px;
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 12px;
}
dt {
  font-family: var(--font-mono);
  color: var(--accent-yellow);
}
dd {
  margin: 0;
  color: var(--fg-muted);
}
.dialog-footer {
  margin-top: 16px;
  font-size: 11px;
  color: var(--fg-dim);
  text-align: center;
}
kbd {
  background: var(--bg-pane-focus);
  border: 1px solid var(--border);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
