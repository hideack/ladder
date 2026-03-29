import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import fetch from 'node-fetch';
import { homedir } from 'os';
import { openDb } from '../db/schema.js';
import { Queries } from '../db/queries.js';
import type { Entry } from '../db/queries.js';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const info    = (msg: string) => console.log(`  ${c.cyan}→${c.reset} ${msg}`);
const success = (msg: string) => console.log(`  ${c.green}✓${c.reset} ${msg}`);
const fail    = (msg: string) => console.log(`  ${c.red}✗${c.reset} ${msg}`);
const skip    = (msg: string) => console.log(`  ${c.gray}–${c.reset} ${msg}`);

export interface PodcastDownloadOptions {
  days?:  string;
  count?: string;
  feed?:  string;
  dir?:   string;
}

export function buildFilename(entry: Entry & { feed_title: string }): string {
  let ext = '.mp3';
  try {
    ext = path.extname(new URL(entry.enclosure_url!).pathname) || '.mp3';
  } catch { /* malformed URL — use default */ }

  const slug = entry.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${entry.id}-${slug}${ext}`;
}

export async function downloadEpisode(
  enclosureUrl: string,
  destPath: string
): Promise<{ sizeBytes: number }> {
  const tmpPath = destPath + '.tmp';

  const response = await fetch(enclosureUrl, {
    headers: { 'User-Agent': 'ladder/0.1.0' },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error('Response body is null');
  }

  const dest = fs.createWriteStream(tmpPath);
  try {
    await pipeline(response.body as NodeJS.ReadableStream, dest);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }

  const { size } = fs.statSync(tmpPath);
  fs.renameSync(tmpPath, destPath);
  return { sizeBytes: size };
}

export async function cmdPodcastDownload(opts: PodcastDownloadOptions): Promise<void> {
  const days   = opts.days   != null ? parseInt(opts.days,   10) : undefined;
  const count  = opts.count  != null ? parseInt(opts.count,  10) : undefined;
  const feedId = opts.feed   != null ? parseInt(opts.feed,   10) : undefined;

  if (days   != null && (isNaN(days)   || days   < 1)) { console.error('--days must be a positive integer');  process.exit(1); }
  if (count  != null && (isNaN(count)  || count  < 1)) { console.error('--count must be a positive integer'); process.exit(1); }
  if (feedId != null && isNaN(feedId))                 { console.error('--feed must be a valid feed id');     process.exit(1); }

  const downloadDir = opts.dir
    ? path.resolve(opts.dir)
    : path.join(homedir(), '.config', 'ladder', 'podcasts');

  fs.mkdirSync(downloadDir, { recursive: true });

  const sinceUnix = days != null
    ? Math.floor(Date.now() / 1000) - days * 86400
    : undefined;

  const db = openDb();
  const q  = new Queries(db);

  if (feedId != null) {
    const feed = q.getFeedById(feedId);
    if (!feed) {
      console.error(`Feed not found: id=${feedId}`);
      process.exit(1);
    }
    console.log(`${c.bold}Feed:${c.reset} ${c.cyan}${feed.title}${c.reset} (id=${feedId})`);
  }

  const entries = q.getPodcastEntries({ feedId, sinceUnix, limit: count });

  if (entries.length === 0) {
    info('No podcast episodes found matching the criteria.');
    return;
  }

  console.log(`\n${c.bold}Downloading ${entries.length} episode(s)${c.reset} → ${c.cyan}${downloadDir}${c.reset}\n`);

  let downloaded = 0;
  let skipped    = 0;
  let failed     = 0;

  for (const entry of entries) {
    const filename = buildFilename(entry);
    const destPath = path.join(downloadDir, filename);

    if (fs.existsSync(destPath)) {
      skip(`${filename} ${c.gray}(already downloaded)${c.reset}`);
      skipped++;
      continue;
    }

    info(`${entry.feed_title} — ${c.bold}${entry.title}${c.reset}`);
    info(`  ${c.gray}${entry.enclosure_url}${c.reset}`);

    try {
      const { sizeBytes } = await downloadEpisode(entry.enclosure_url!, destPath);
      const sizeMb = (sizeBytes / 1_048_576).toFixed(1);
      success(`${filename} ${c.gray}(${sizeMb} MB)${c.reset}`);
      downloaded++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`${filename} — ${msg}`);
      failed++;
    }
  }

  console.log('');
  console.log(`${c.bold}Done.${c.reset} Downloaded: ${c.green}${downloaded}${c.reset}, Skipped: ${c.gray}${skipped}${c.reset}, Failed: ${c.red}${failed}${c.reset}`);
}
