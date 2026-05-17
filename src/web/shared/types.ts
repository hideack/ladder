export type FilterMode = 'active' | 'unread' | 'all';
export type SortMode = 'unread' | 'latest';

export interface ApiCategory {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface ApiFeed {
  id: number;
  url: string;
  site_url: string | null;
  title: string;
  category_id: number | null;
  unread_count: number;
  error_count: number;
  next_retry_at: number | null;
  last_fetched_at: number | null;
  latest_entry_at: number | null;
}

export interface ApiEntrySummary {
  id: number;
  feed_id: number;
  feed_title: string;
  title: string;
  url: string | null;
  author: string | null;
  published_at: number | null;
  is_read: boolean;
  is_pinned: boolean;
  has_enclosure: boolean;
}

export interface ApiEntryDetail extends ApiEntrySummary {
  content: string | null;
  enclosure_url: string | null;
  enclosure_type: string | null;
  enclosure_length: number | null;
}

export interface FullContentResponse {
  text: string;
  url: string | null;
}

export type SseEvent =
  | { type: 'hello' }
  | { type: 'crawl-done'; feedIds: number[] }
  | { type: 'feed-updated'; feedId: number; unreadCount: number };
