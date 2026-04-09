import fs from 'fs';
import path from 'path';
import { homedir } from 'os';

const KEYLOG_PATH = path.join(homedir(), '.config', 'ladder', 'keylog.jsonl');
const RETENTION_DAYS = 30;

export function pruneKeylog(): void {
  if (!fs.existsSync(KEYLOG_PATH)) return;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    const lines = fs.readFileSync(KEYLOG_PATH, 'utf-8').split('\n').filter(Boolean);
    const kept = lines.filter((line) => {
      try {
        const entry = JSON.parse(line) as { ts: string };
        return new Date(entry.ts).getTime() >= cutoff;
      } catch {
        return false;
      }
    });
    fs.writeFileSync(KEYLOG_PATH, kept.length > 0 ? kept.join('\n') + '\n' : '');
  } catch {
    // ログ操作のエラーは無視
  }
}

export function logKey(key: string, pane: string): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), key, pane }) + '\n';
  fs.appendFile(KEYLOG_PATH, line, () => {});
}
