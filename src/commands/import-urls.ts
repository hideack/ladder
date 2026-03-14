import { readFileSync } from 'fs';
import { openDb } from '../db/schema.js';
import { Queries } from '../db/queries.js';

export function cmdImportUrls(file: string): void {
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    console.error(`Cannot read file: ${file}`);
    process.exit(1);
  }

  const db = openDb();
  const q = new Queries(db);

  let added = 0;
  let skipped = 0;

  for (const raw of text.split('\n')) {
    // コメント・空行をスキップ
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // 先頭トークンをURLとして扱う（newsboat の "url ~tag" 形式にも対応）
    const url = line.split(/\s+/)[0];
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;

    if (q.getFeedByUrl(url)) {
      skipped++;
      continue;
    }

    q.createFeed(url, '');
    added++;
    console.log(`  + ${url}`);
  }

  console.log(`\nDone. Added: ${added}, Skipped (duplicate): ${skipped}`);
  if (added > 0) {
    console.log(`Run "ladder fetch" to retrieve titles and entries.`);
  }
}
