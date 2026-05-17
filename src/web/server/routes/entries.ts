import { Hono } from 'hono';
import type { Queries } from '../../../db/queries.js';
import type { ApiEntryDetail, FullContentResponse } from '../../shared/types.js';
import { fetchArticleContent } from '../../../crawler/content-fetcher.js';
import { isAudioEnclosure } from '../lib/enclosure.js';

export function entriesRoutes(q: Queries): Hono {
  const app = new Hono();

  app.get('/entries/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid entry id' }, 400);

    const entry = q.getEntryWithFeedTitle(id);
    if (!entry) return c.json({ error: 'not found' }, 404);

    const isAudio = isAudioEnclosure(entry.enclosure_type, entry.enclosure_url);
    const body: ApiEntryDetail = {
      id: entry.id,
      feed_id: entry.feed_id,
      feed_title: entry.feed_title,
      title: entry.title,
      url: entry.url,
      author: entry.author,
      published_at: entry.published_at,
      is_read: entry.is_read === 1,
      is_pinned: entry.is_pinned === 1,
      has_enclosure: isAudio,
      content: entry.content,
      enclosure_url: isAudio ? entry.enclosure_url : null,
      enclosure_type: isAudio ? entry.enclosure_type : null,
      enclosure_length: isAudio ? entry.enclosure_length : null,
    };
    return c.json(body);
  });

  app.patch('/entries/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid entry id' }, 400);

    const body = await c.req
      .json<{ read?: boolean; pinned?: boolean }>()
      .catch(() => ({} as { read?: boolean; pinned?: boolean }));
    const existing = q.getEntryById(id);
    if (!existing) return c.json({ error: 'not found' }, 404);

    if (typeof body.read === 'boolean') {
      const currentRead = existing.is_read === 1;
      if (currentRead !== body.read) {
        q.toggleRead(id);
      }
    }
    if (typeof body.pinned === 'boolean') {
      const currentPinned = existing.is_pinned === 1;
      if (currentPinned !== body.pinned) {
        q.togglePin(id);
      }
    }

    const updated = q.getEntryById(id);
    return c.json({
      id,
      read: updated?.is_read === 1,
      pinned: updated?.is_pinned === 1,
    });
  });

  app.get('/entries/:id/full-content', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid entry id' }, 400);
    const entry = q.getEntryById(id);
    if (!entry) return c.json({ error: 'not found' }, 404);
    if (!entry.url) return c.json({ error: 'entry has no url' }, 400);

    try {
      const text = await fetchArticleContent(entry.url);
      const body: FullContentResponse = { text, url: entry.url };
      return c.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 502);
    }
  });

  return app;
}
