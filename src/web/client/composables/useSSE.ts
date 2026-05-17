import { onMounted, onUnmounted } from 'vue';
import type { SseEvent } from '@shared/types';

export function useSSE(handler: (event: SseEvent) => void) {
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;

  function connect() {
    source = new EventSource('/events');
    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SseEvent;
        handler(event);
      } catch (err) {
        console.error('SSE parse error', err);
      }
    };
    source.onerror = () => {
      source?.close();
      source = null;
      reconnectTimer = window.setTimeout(connect, 3000);
    };
  }

  onMounted(() => connect());
  onUnmounted(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.close();
  });
}
