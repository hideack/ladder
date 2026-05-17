import { watch } from 'fs';
import { existsSync } from 'fs';
import type { Queries } from '../../db/queries.js';
import { sseBus } from './sse-bus.js';
import { getDbPath } from '../../db/schema.js';

const DEBOUNCE_MS = 500;
const LOOKBACK_SEC = 30;

/**
 * Watches the SQLite WAL file for changes and emits SSE events when feeds get
 * new entries. Cross-process update_hook isn't available, so we use fs.watch
 * on the WAL file and re-query to determine which feeds changed.
 */
export function startDbWatcher(q: Queries): () => void {
  const dbPath = getDbPath();
  const walPath = `${dbPath}-wal`;

  let lastCheckUnix = Math.floor(Date.now() / 1000);
  let debounceTimer: NodeJS.Timeout | null = null;

  const checkChanges = () => {
    debounceTimer = null;
    const now = Math.floor(Date.now() / 1000);
    const since = Math.max(0, lastCheckUnix - LOOKBACK_SEC);
    lastCheckUnix = now;

    try {
      const feeds = q.getAllFeeds();
      const updatedFeedIds: number[] = [];
      for (const f of feeds) {
        if (f.last_fetched_at != null && f.last_fetched_at >= since) {
          updatedFeedIds.push(f.id);
        }
      }
      if (updatedFeedIds.length > 0) {
        sseBus.publish({ type: 'crawl-done', feedIds: updatedFeedIds });
        for (const id of updatedFeedIds) {
          const feed = feeds.find((f) => f.id === id);
          if (feed) {
            sseBus.publish({
              type: 'feed-updated',
              feedId: feed.id,
              unreadCount: feed.unread_count,
            });
          }
        }
      }
    } catch (err) {
      console.error('db-watcher: check failed', err);
    }
  };

  const onChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkChanges, DEBOUNCE_MS);
  };

  // WAL may not exist until first write; watch the directory so we don't miss creation.
  const watchTarget = existsSync(walPath) ? walPath : dbPath;
  const watcher = watch(watchTarget, { persistent: false }, onChange);
  watcher.on('error', (err) => {
    console.error('db-watcher: error', err);
  });

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
}
