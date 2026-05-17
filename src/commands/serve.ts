import { serve } from '@hono/node-server';
import { openDb } from '../db/schema.js';
import { Queries } from '../db/queries.js';
import { buildApp } from '../web/server/app.js';
import { startDbWatcher } from '../web/server/db-watcher.js';

export interface ServeOptions {
  port?: string;
  host?: string;
}

export async function cmdServe(options: ServeOptions): Promise<void> {
  const port = Number(options.port ?? 4317);
  const host = options.host ?? '127.0.0.1';

  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error(`Invalid --port: ${options.port}`);
    process.exit(1);
  }

  const db = openDb();
  const q = new Queries(db);
  const app = buildApp(q);

  const stopWatcher = startDbWatcher(q);

  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.log(`ladder serve listening on http://${info.address}:${info.port}`);
  });

  const shutdown = () => {
    stopWatcher();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
