#!/usr/bin/env node
import { Command } from 'commander';
import { cmdAdd } from '../src/commands/add.js';
import { cmdFetch } from '../src/commands/fetch.js';
import { cmdUi } from '../src/commands/ui.js';
import { registerCategoryCommands } from '../src/commands/category.js';
import { registerFeedCommands } from '../src/commands/feed.js';
import { cmdOpmlImport, cmdOpmlExport } from '../src/commands/opml.js';
import { cmdImportUrls } from '../src/commands/import-urls.js';
import { openDb } from '../src/db/schema.js';
import { Queries } from '../src/db/queries.js';
import { startMcpServer } from '../src/mcp/server.js';

const program = new Command();

program
  .name('ladder')
  .description('CLI RSS reader — fastladder のオマージュ')
  .version('0.1.0');

// ── ui ────────────────────────────────────────────────────────────────────────
program
  .command('ui')
  .description('Launch the 3-pane TUI')
  .action(async () => {
    await cmdUi();
  });

// ── add ───────────────────────────────────────────────────────────────────────
program
  .command('add <url>')
  .description('Subscribe to a feed URL')
  .action(async (url: string) => {
    await cmdAdd(url);
  });

// ── fetch ─────────────────────────────────────────────────────────────────────
program
  .command('fetch')
  .description('Crawl feeds and store new entries')
  .option('--feed <id>', 'Crawl a specific feed by id')
  .action(async (options: { feed?: string }) => {
    await cmdFetch(options);
  });

// ── category ──────────────────────────────────────────────────────────────────
registerCategoryCommands(program);

// ── feed ──────────────────────────────────────────────────────────────────────
registerFeedCommands(program);

// ── opml ──────────────────────────────────────────────────────────────────────
const opml = program.command('opml').description('OPML import/export');

opml
  .command('import <file>')
  .description('Import subscriptions from an OPML file')
  .action(async (file: string) => {
    await cmdOpmlImport(file);
  });

opml
  .command('export [file]')
  .description('Export subscriptions to an OPML file (stdout if omitted)')
  .action(async (file?: string) => {
    await cmdOpmlExport(file);
  });

// ── import-urls ───────────────────────────────────────────────────────────────
program
  .command('import-urls <file>')
  .description('Import feed URLs from a plain text file (one URL per line)')
  .action((file: string) => {
    cmdImportUrls(file);
  });

// ── purge ─────────────────────────────────────────────────────────────────────
program
  .command('purge')
  .description('Delete old read entries')
  .option('--days <n>', 'Delete entries older than n days', '90')
  .action((options: { days: string }) => {
    const days = parseInt(options.days, 10);
    if (isNaN(days) || days < 1) {
      console.error('Invalid --days value');
      process.exit(1);
    }
    const db = openDb();
    const q = new Queries(db);
    const deleted = q.purgeEntries(days);
    console.log(`Purged ${deleted} entries older than ${days} days.`);
  });

// ── mcp ───────────────────────────────────────────────────────────────────────
program
  .command('mcp')
  .description('Start MCP server (stdio transport)')
  .action(async () => {
    await startMcpServer();
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
