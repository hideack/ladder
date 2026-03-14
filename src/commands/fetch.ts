import { openDb } from '../db/schema.js';
import { crawlFeed } from '../crawler/index.js';

export async function cmdFetch(options: { feed?: string }): Promise<void> {
  const db = openDb();
  const feedId = options.feed != null ? parseInt(options.feed, 10) : undefined;

  if (feedId != null && isNaN(feedId)) {
    console.error(`Invalid feed id: ${options.feed}`);
    process.exit(1);
  }

  console.log(feedId != null ? `Fetching feed #${feedId}...` : 'Fetching all feeds...');

  const result = await crawlFeed(db, feedId);

  console.log(`Fetched: ${result.fetched}, New entries: ${result.newEntries}`);
  if (result.errors.length > 0) {
    console.error(`Errors (${result.errors.length}):`);
    for (const e of result.errors) {
      console.error(`  feed #${e.feed_id}: ${e.message}`);
    }
  }
}
