import blessed from 'neo-blessed';
import { Queries, Entry } from '../db/queries.js';
import type { FilterMode } from './feed-list.js';

const STALE_THRESHOLD_SEC = 180 * 24 * 60 * 60; // 180 days (FeedList と同じ閾値)

export class UnifiedEntryList {
  private entries: Array<Entry & { feed_title: string }> = [];
  private selectedIndex = 0;
  private viewTop = 0;
  private limit = 200;
  private filterMode: FilterMode = 'active';
  private q: Queries;

  constructor(
    private pane: blessed.Widgets.BoxElement,
    q: Queries
  ) {
    this.q = q;
  }

  private fetchEntries(): Array<Entry & { feed_title: string }> {
    const all = this.q.getEntriesWithFeedTitle(null, true, false, this.limit, 0) as Array<Entry & { feed_title: string }>;

    if (this.filterMode === 'all') return all;

    // active / unread: 対象フィードIDを FeedList と同じ条件で絞り込む
    const feeds = this.q.getAllFeedsWithLatest();
    const now = Math.floor(Date.now() / 1000);
    const allowedIds = new Set(
      feeds.filter((f) => {
        if (this.filterMode === 'active') {
          return f.unread_count > 0 && f.latest_entry_at != null && now - f.latest_entry_at <= STALE_THRESHOLD_SEC;
        }
        // 'unread'
        return f.unread_count > 0;
      }).map((f) => f.id)
    );

    return all.filter((e) => allowedIds.has(e.feed_id));
  }

  load(filterMode: FilterMode = this.filterMode, limit = this.limit): void {
    this.filterMode = filterMode;
    this.limit = limit;
    this.entries = this.fetchEntries();
    this.selectedIndex = 0;
    this.viewTop = 0;
    this.render();
  }

  refresh(): void {
    const prevId = this.getSelected()?.id ?? null;
    this.entries = this.fetchEntries();
    // 同じ記事にカーソルを戻す（見つからなければ先頭）
    if (prevId != null) {
      const idx = this.entries.findIndex((e) => e.id === prevId);
      this.selectedIndex = idx >= 0 ? idx : 0;
    } else {
      this.selectedIndex = 0;
    }
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.entries.length - 1));
    this.render();
  }

  private formatEntry(entry: Entry & { feed_title: string }, index: number): string {
    const selected = index === this.selectedIndex;
    const prefix = selected ? '{inverse}' : '';
    const suffix = selected ? '{/inverse}' : '';

    const readMark = entry.is_pinned
      ? '{yellow-fg}★{/yellow-fg}'
      : entry.is_read
      ? '  '
      : '{blue-fg}●{/blue-fg} ';

    const title = entry.title || '(no title)';
    const maxTitleLen = 32;
    const truncatedTitle = title.length > maxTitleLen ? title.substring(0, maxTitleLen - 1) + '…' : title;

    const feedName = entry.feed_title || '';
    const maxFeedLen = 15;
    const truncatedFeed = feedName.length > maxFeedLen ? feedName.substring(0, maxFeedLen - 1) + '…' : feedName;

    const dateStr = entry.published_at ? formatRelativeTime(entry.published_at) : '';

    return `${prefix}${readMark}${truncatedTitle} {gray-fg}(${truncatedFeed})  ${dateStr}{/gray-fg}${suffix}`;
  }

  render(): void {
    const lines = this.entries.map((e, i) => this.formatEntry(e, i));
    this.pane.setContent(lines.length > 0 ? lines.join('\n') : '  (no unread entries)');

    const innerHeight = Math.max(1, (this.pane.height as number) - 2);
    if (this.selectedIndex < this.viewTop) {
      this.viewTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.viewTop + innerHeight) {
      this.viewTop = this.selectedIndex - innerHeight + 1;
    }
    this.pane.scrollTo(this.viewTop);

    const unreadCount = this.entries.filter((e) => !e.is_read).length;
    const filterLabel =
      this.filterMode === 'active' ? ' {red-fg}active{/red-fg}' :
      this.filterMode === 'unread' ? ' {yellow-fg}unread{/yellow-fg}' : '';
    this.pane.setLabel(` Unified (${unreadCount} unread)${filterLabel} `);

    this.pane.screen.render();
  }

  moveDown(): (Entry & { feed_title: string }) | null {
    if (this.selectedIndex < this.entries.length - 1) {
      this.selectedIndex++;
      this.render();
    }
    return this.getSelected();
  }

  moveUp(): (Entry & { feed_title: string }) | null {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.render();
    }
    return this.getSelected();
  }

  movePageDown(): (Entry & { feed_title: string }) | null {
    const pageSize = Math.max(1, (this.pane.height as number) - 2);
    this.selectedIndex = Math.min(this.entries.length - 1, this.selectedIndex + pageSize);
    this.render();
    return this.getSelected();
  }

  movePageUp(): (Entry & { feed_title: string }) | null {
    const pageSize = Math.max(1, (this.pane.height as number) - 2);
    this.selectedIndex = Math.max(0, this.selectedIndex - pageSize);
    this.render();
    return this.getSelected();
  }

  nextUnread(): (Entry & { feed_title: string }) | null {
    for (let i = this.selectedIndex + 1; i < this.entries.length; i++) {
      if (!this.entries[i].is_read) {
        this.selectedIndex = i;
        this.render();
        return this.entries[i];
      }
    }
    return null;
  }

  getSelected(): (Entry & { feed_title: string }) | null {
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
}

function formatRelativeTime(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
