import { EventEmitter } from 'events';
import type { SseEvent } from '../shared/types.js';

class SseBus extends EventEmitter {
  publish(event: SseEvent): void {
    this.emit('event', event);
  }

  subscribe(handler: (event: SseEvent) => void): () => void {
    this.on('event', handler);
    return () => this.off('event', handler);
  }
}

export const sseBus = new SseBus();
sseBus.setMaxListeners(100);
