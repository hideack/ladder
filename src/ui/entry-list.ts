import blessed from 'neo-blessed';
import { Queries, Entry } from '../db/queries.js';

export class EntryList {
  private entries: Array<Entry & { feed_title?: string }> = [];
  private selectedIndex = 0;
  private viewTop = 0;
  private q: Queries;
  private currentFeedId: number | null = null;
  private showPinned = false;

  constructor(
    private pane: blessed.Widgets.BoxElement,
    q: Queries
  ) {
    this.q = q;
  }

  loadFeed(feedId: number): void {
    this.currentFeedId = feedId;
    this.showPinned = false;
    this.entries = this.q.getEntriesByFeed(feedId, 100);
    this.selectedIndex = 0;
    this.viewTop = 0;
    this.render();
  }

  loadPinned(): void {
    this.currentFeedId = null;
    this.showPinned = true;
    this.entries = this.q.getPinnedEntries(100);
    this.selectedIndex = 0;
    this.viewTop = 0;
    this.render();
  }

  loadSearch(query: string): void {
    this.currentFeedId = null;
    this.showPinned = false;
    const results = this.q.searchEntries(query, 50);
    this.entries = results;
    this.selectedIndex = 0;
    this.viewTop = 0;
    this.render();
  }

  refresh(): void {
    if (this.showPinned) {
      this.loadPinned();
    } else if (this.currentFeedId != null) {
      this.loadFeed(this.currentFeedId);
    }
  }

  private formatEntry(entry: Entry & { feed_title?: string }, index: number): string {
    const selected = index === this.selectedIndex;
    const prefix = selected ? '{inverse}' : '';
    const suffix = selected ? '{/inverse}' : '';

    const readMark = entry.is_pinned
      ? '{yellow-fg}★{/yellow-fg}'
      : entry.is_read
      ? ' '
      : '{blue-fg}●{/blue-fg}';

    const title = entry.title || '(no title)';
    const maxLen = 36;
    const truncated = title.length > maxLen ? title.substring(0, maxLen - 1) + '…' : title;

    const dateStr = entry.published_at
      ? formatRelativeTime(entry.published_at)
      : '';

    return `${prefix}${readMark} ${truncated} {gray-fg}${dateStr}{/gray-fg}${suffix}`;
  }

  render(): void {
    const lines = this.entries.map((e, i) => this.formatEntry(e, i));
    this.pane.setContent('');
    this.pane.setContent(lines.length > 0 ? lines.join('\n') : '  (no entries)');

    // 端に達したときだけスクロール（カーソルは自然に動く）
    const innerHeight = Math.max(1, (this.pane.height as number) - 2);
    if (this.selectedIndex < this.viewTop) {
      this.viewTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.viewTop + innerHeight) {
      this.viewTop = this.selectedIndex - innerHeight + 1;
    }
    this.pane.scrollTo(this.viewTop);

    const label = this.showPinned
      ? ' ★ Pinned '
      : this.currentFeedId != null
      ? ` Entries (${this.entries.length}) `
      : ' Entries ';
    this.pane.setLabel(label);

    this.pane.screen.render();
  }

  moveDown(): Entry | null {
    if (this.selectedIndex < this.entries.length - 1) {
      this.selectedIndex++;
      this.render();
    }
    return this.getSelected();
  }

  moveUp(): Entry | null {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.render();
    }
    return this.getSelected();
  }

  movePageDown(): Entry | null {
    const pageSize = Math.max(1, (this.pane.height as number) - 2);
    this.selectedIndex = Math.min(this.entries.length - 1, this.selectedIndex + pageSize);
    this.render();
    return this.getSelected();
  }

  movePageUp(): Entry | null {
    const pageSize = Math.max(1, (this.pane.height as number) - 2);
    this.selectedIndex = Math.max(0, this.selectedIndex - pageSize);
    this.render();
    return this.getSelected();
  }

  nextUnread(): Entry | null {
    for (let i = this.selectedIndex + 1; i < this.entries.length; i++) {
      if (!this.entries[i].is_read) {
        this.selectedIndex = i;
        this.render();
        return this.entries[i];
      }
    }
    return null;
  }

  prevUnread(): Entry | null {
    for (let i = this.selectedIndex - 1; i >= 0; i--) {
      if (!this.entries[i].is_read) {
        this.selectedIndex = i;
        this.render();
        return this.entries[i];
      }
    }
    return null;
  }

  firstUnread(): Entry | null {
    for (let i = 0; i < this.entries.length; i++) {
      if (!this.entries[i].is_read) {
        this.selectedIndex = i;
        this.render();
        return this.entries[i];
      }
    }
    return null;
  }

  getSelected(): Entry | null {
    return this.entries[this.selectedIndex] ?? null;
  }

  markSelectedAsRead(): void {
    const entry = this.getSelected();
    if (!entry || entry.is_read) return;
    this.q.markAsRead(entry.id);
    entry.is_read = 1;
    this.render();
  }

  togglePinSelected(): void {
    const entry = this.getSelected();
    if (!entry) return;
    this.q.togglePin(entry.id);
    entry.is_pinned = entry.is_pinned ? 0 : 1;
    this.render();
  }

  toggleReadSelected(): void {
    const entry = this.getSelected();
    if (!entry) return;
    this.q.toggleRead(entry.id);
    entry.is_read = entry.is_read ? 0 : 1;
    this.render();
  }

  markAllAsRead(): void {
    if (this.currentFeedId == null) return;
    this.q.markFeedAsRead(this.currentFeedId);
    for (const e of this.entries) {
      e.is_read = 1;
    }
    this.render();
  }

  getCurrentFeedId(): number | null {
    return this.currentFeedId;
  }
}

function formatRelativeTime(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
