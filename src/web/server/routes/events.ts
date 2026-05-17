import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { sseBus } from '../sse-bus.js';
import type { SseEvent } from '../../shared/types.js';

export function eventsRoutes(): Hono {
  const app = new Hono();

  app.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      const hello: SseEvent = { type: 'hello' };
      await stream.writeSSE({ data: JSON.stringify(hello), event: 'message' });

      const queue: SseEvent[] = [];
      let resolveWait: (() => void) | null = null;
      const wakeup = () => {
        if (resolveWait) {
          const r = resolveWait;
          resolveWait = null;
          r();
        }
      };

      const unsubscribe = sseBus.subscribe((event) => {
        queue.push(event);
        wakeup();
      });

      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
        unsubscribe();
        wakeup();
      });

      // Heartbeat every 15s to keep proxies happy
      const heartbeat = setInterval(() => {
        queue.push({ type: 'hello' });
        wakeup();
      }, 15_000);

      try {
        while (!aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => { resolveWait = resolve; });
            continue;
          }
          const ev = queue.shift()!;
          await stream.writeSSE({ data: JSON.stringify(ev), event: 'message' });
        }
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });

  return app;
}
