import { Command } from 'commander';
import { openDb } from '../db/schema.js';
import { Queries } from '../db/queries.js';

export function registerFeedCommands(program: Command): void {
  const feed = program.command('feed').description('Manage feeds');

  feed
    .command('move <feed-id> <category-name>')
    .description('Move feed to a category')
    .option('--uncategorize', 'Remove feed from its current category')
    .action((feedIdStr: string, categoryName: string, options: { uncategorize?: boolean }) => {
      const db = openDb();
      const q = new Queries(db);
      const feedId = parseInt(feedIdStr, 10);

      if (isNaN(feedId)) {
        console.error(`Invalid feed id: ${feedIdStr}`);
        process.exit(1);
      }

      const feedRecord = q.getFeedById(feedId);
      if (!feedRecord) {
        console.error(`Feed not found: id=${feedId}`);
        process.exit(1);
      }

      if (options.uncategorize) {
        q.moveFeedToCategory(feedId, null);
        console.log(`Feed "${feedRecord.title}" removed from category.`);
        return;
      }

      const cat = q.getCategoryByName(categoryName);
      if (!cat) {
        console.error(`Category not found: "${categoryName}"`);
        process.exit(1);
      }

      q.moveFeedToCategory(feedId, cat.id);
      console.log(`Feed "${feedRecord.title}" moved to category "${cat.name}".`);
    });
}
