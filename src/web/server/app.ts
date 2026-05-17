import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { Queries } from '../../db/queries.js';
import { feedsRoutes } from './routes/feeds.js';
import { entriesRoutes } from './routes/entries.js';
import { eventsRoutes } from './routes/events.js';

/**
 * Locate the built SPA. We search relative to the entrypoint binary location
 * (CJS: __dirname is available; ESM via tsx: derive from process.argv[1]) and
 * a few fallbacks rooted at process.cwd().
 */
function findDistRoot(): string | null {
  const candidates: string[] = [];

  // CJS bundle: __dirname points to bin/, dist/web sits alongside.
  if (typeof __dirname !== 'undefined') {
    candidates.push(join(__dirname, '..', 'dist', 'web'));
    candidates.push(join(__dirname, '..', '..', 'dist', 'web'));
    candidates.push(join(__dirname, '..', '..', '..', 'dist', 'web'));
  }

  // tsx/ESM: derive from process.argv[1] (the entrypoint file).
  if (process.argv[1]) {
    const entry = dirname(process.argv[1]);
    candidates.push(join(entry, '..', 'dist', 'web'));
    candidates.push(join(entry, 'dist', 'web'));
  }

  candidates.push(join(process.cwd(), 'dist', 'web'));

  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

export function buildApp(q: Queries): Hono {
  const app = new Hono();

  app.route('/api', feedsRoutes(q));
  app.route('/api', entriesRoutes(q));
  app.route('/', eventsRoutes());

  const distRoot = findDistRoot();
  if (distRoot) {
    app.use('/*', serveStatic({ root: distRoot }));
    // SPA fallback for unknown paths so the Vue router (if any later) works.
    app.get('*', (c) => {
      const indexPath = join(distRoot, 'index.html');
      const html = readFileSync(indexPath, 'utf8');
      return c.html(html);
    });
  } else {
    app.get('/', (c) =>
      c.text(
        'ladder web UI has not been built yet.\nRun `npm run build:web` (or `npm run dev:client` for HMR).',
        503
      )
    );
  }

  return app;
}
