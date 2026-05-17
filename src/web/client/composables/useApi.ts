import type {
  ApiEntryDetail,
  ApiEntrySummary,
  ApiFeed,
  ApiCategory,
  FilterMode,
  FullContentResponse,
  SortMode,
} from '@shared/types';

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export interface FeedsResponse {
  feeds: ApiFeed[];
  total_unread: number;
  categories: ApiCategory[];
}

export interface EntriesResponse {
  entries: ApiEntrySummary[];
}

export const api = {
  async getFeeds(filter: FilterMode, sort: SortMode): Promise<FeedsResponse> {
    return jsonFetch<FeedsResponse>(`/api/feeds?filter=${filter}&sort=${sort}`);
  },
  async getEntries(feedId: number | 'pinned'): Promise<EntriesResponse> {
    return jsonFetch<EntriesResponse>(`/api/feeds/${feedId}/entries`);
  },
  async getEntry(id: number): Promise<ApiEntryDetail> {
    return jsonFetch<ApiEntryDetail>(`/api/entries/${id}`);
  },
  async getFullContent(id: number): Promise<FullContentResponse> {
    return jsonFetch<FullContentResponse>(`/api/entries/${id}/full-content`);
  },
  async patchEntry(
    id: number,
    body: { read?: boolean; pinned?: boolean }
  ): Promise<{ id: number; read: boolean; pinned: boolean }> {
    return jsonFetch(`/api/entries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  async markFeedAllRead(feedId: number): Promise<{ updated_count: number }> {
    return jsonFetch(`/api/feeds/${feedId}/mark-all-read`, { method: 'POST' });
  },
};
