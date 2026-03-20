import blessed from 'neo-blessed';
import { convert } from 'html-to-text';
import { Entry } from '../db/queries.js';

export class EntryView {
  constructor(private pane: blessed.Widgets.BoxElement) {}

  /** フィードのコンテンツをそのまま表示する（通常表示） */
  show(entry: Entry & { feed_title?: string }): void {
    const title = entry.title || '(no title)';
    const feedTitle = entry.feed_title ?? '';
    const dateStr = entry.published_at
      ? new Date(entry.published_at * 1000).toLocaleString()
      : 'Unknown date';
    const author = entry.author ? ` · ${entry.author}` : '';

    let bodyText = '';
    if (entry.content) {
      try {
        bodyText = convert(entry.content, {
          wordwrap: 78,
          selectors: [
            { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
            { selector: 'img', format: 'skip' },
          ],
        });
      } catch {
        bodyText = entry.content.replace(/<[^>]+>/g, '');
      }
    }

    const content = [
      `{bold}{cyan-fg}${escapeMarkup(title)}{/cyan-fg}{/bold}`,
      ``,
      `{gray-fg}${escapeMarkup(feedTitle)}${escapeMarkup(author)} · ${escapeMarkup(dateStr)}{/gray-fg}`,
      ``,
      `─`.repeat(40),
      ``,
      escapeMarkup(bodyText),
    ].join('\n');

    this.pane.setContent('');
    this.pane.setContent(content);
    this.pane.setLabel(` Content `);
    // Reset scroll to top
    this.pane.scrollTo(0);
    this.pane.screen.render();
  }

  /** AI で要約または翻訳したテキストを表示する（E キー押下時） */
  showAiProcessed(entry: Entry & { feed_title?: string }, aiText: string): void {
    const title = entry.title || '(no title)';
    const feedTitle = entry.feed_title ?? '';
    const dateStr = entry.published_at
      ? new Date(entry.published_at * 1000).toLocaleString()
      : 'Unknown date';
    const author = entry.author ? ` · ${entry.author}` : '';

    const content = [
      `{bold}{cyan-fg}${escapeMarkup(title)}{/cyan-fg}{/bold}`,
      ``,
      `{gray-fg}${escapeMarkup(feedTitle)}${escapeMarkup(author)} · ${escapeMarkup(dateStr)}{/gray-fg}`,
      ``,
      `{magenta-fg}[AI Processed]{/magenta-fg}`,
      `─`.repeat(40),
      ``,
      escapeMarkup(aiText),
    ].join('\n');

    this.pane.setContent('');
    this.pane.setContent(content);
    this.pane.setLabel(` Content {magenta-fg}[AI]{/magenta-fg} `);
    this.pane.scrollTo(0);
    this.pane.screen.render();
  }

  /** サイトから取得した全文を表示する（e キー押下時） */
  showFetched(entry: Entry & { feed_title?: string }, fetchedText: string): void {
    const title = entry.title || '(no title)';
    const feedTitle = entry.feed_title ?? '';
    const dateStr = entry.published_at
      ? new Date(entry.published_at * 1000).toLocaleString()
      : 'Unknown date';
    const author = entry.author ? ` · ${entry.author}` : '';

    const content = [
      `{bold}{cyan-fg}${escapeMarkup(title)}{/cyan-fg}{/bold}`,
      ``,
      `{gray-fg}${escapeMarkup(feedTitle)}${escapeMarkup(author)} · ${escapeMarkup(dateStr)}{/gray-fg}`,
      ``,
      `{green-fg}[Full Article]{/green-fg}`,
      `─`.repeat(40),
      ``,
      escapeMarkup(fetchedText),
    ].join('\n');

    this.pane.setContent('');
    this.pane.setContent(content);
    this.pane.setLabel(` Content {green-fg}[Full]{/green-fg} `);
    this.pane.scrollTo(0);
    this.pane.screen.render();
  }

  clear(): void {
    this.pane.setContent('');
    this.pane.setLabel(' Content ');
    this.pane.screen.render();
  }

  scrollDown(): void {
    this.pane.scroll(3);
    this.pane.screen.render();
  }

  scrollPage(): void {
    const pageSize = Math.max(1, (this.pane.height as number) - 2);
    this.pane.scroll(pageSize);
    this.pane.screen.render();
  }

  scrollPageUp(): void {
    const pageSize = Math.max(1, (this.pane.height as number) - 2);
    this.pane.scroll(-pageSize);
    this.pane.screen.render();
  }

  scrollUp(): void {
    this.pane.scroll(-3);
    this.pane.screen.render();
  }
}

function escapeMarkup(text: string): string {
  return text
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}
