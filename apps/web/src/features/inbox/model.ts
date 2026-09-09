import type { CreateInboxInput, InboxItem, InboxPreview } from '@vital/dto';
import { extractInboxInputSchema } from '@vital/dto';

export const PASTE_URL_ID = 'inbox-paste-url';
export const READER_SIZES = ['sm', 'md', 'lg'] as const;
export type ReaderSize = (typeof READER_SIZES)[number];

export type PendingSave = {
  id: string;
  url: string;
  phase: 'processing' | 'failed';
  error: string | null;
  preview: InboxPreview | null;
};

export function normalizePasteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (scheme) {
    const name = scheme[1]?.toLowerCase();
    if (name !== 'http' && name !== 'https') return null;
  }
  const direct = extractInboxInputSchema.safeParse({ url: trimmed });
  if (direct.success) return direct.data.url;
  if (trimmed.includes(' ') || trimmed.includes('\n')) return null;
  const withProto = extractInboxInputSchema.safeParse({ url: `https://${trimmed}` });
  return withProto.success ? withProto.data.url : null;
}

export function pendingIdForUrl(url: string): string {
  return `url:${url}`;
}

function newestFirst(items: InboxItem[]): InboxItem[] {
  return items.slice().sort((a, b) => {
    if (a.capturedAt === b.capturedAt) return b.id.localeCompare(a.id);
    return a.capturedAt < b.capturedAt ? 1 : -1;
  });
}

export type InboxFilter = 'all' | 'unread' | 'favorite' | 'archived';

export function parseInboxFilter(raw: string | null): InboxFilter {
  if (raw === 'unread' || raw === 'favorite' || raw === 'archived') return raw;
  return 'all';
}

const TAG_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseInboxTagId(raw: string | null): string | null {
  if (raw === null || raw === '') return null;
  return TAG_ID_RE.test(raw) ? raw.toLowerCase() : null;
}

export function inboxHref(filter: InboxFilter, tagId: string | null): string {
  const q = new URLSearchParams();
  if (filter !== 'all') q.set('filter', filter);
  if (tagId) q.set('tag', tagId);
  const s = q.toString();
  return s === '' ? '/inbox' : `/inbox?${s}`;
}

export function filterSaves(
  items: InboxItem[],
  filter: InboxFilter,
  tagId: string | null = null,
): InboxItem[] {
  let live = items.filter((item) => item.deletedAt === null);
  if (tagId) live = live.filter((item) => (item.tagIds ?? []).includes(tagId));
  if (filter === 'archived') return newestFirst(live.filter((item) => item.status === 'archived'));
  if (filter === 'unread') return newestFirst(live.filter((item) => item.status === 'unread'));
  if (filter === 'favorite') return newestFirst(live.filter((item) => item.status === 'later'));
  return newestFirst(live.filter((item) => item.status !== 'archived'));
}

export function visibleSaves(items: InboxItem[]): InboxItem[] {
  return filterSaves(items, 'all');
}

export function archivedSaves(items: InboxItem[]): InboxItem[] {
  return filterSaves(items, 'archived');
}

export function isFavorite(item: InboxItem): boolean {
  return item.status === 'later';
}

export function canPatchStatus(item: InboxItem): boolean {
  return item.status === 'unread' || item.status === 'later' || item.status === 'archived';
}

export function nextFavoriteStatus(item: InboxItem): 'later' | 'unread' {
  return item.status === 'later' ? 'unread' : 'later';
}

export function createInputFromPreview(preview: InboxPreview, title?: string): CreateInboxInput {
  const nextTitle = (title ?? preview.title).trim();
  return {
    title: nextTitle === '' ? preview.title : nextTitle,
    originalUrl: preview.originalUrl,
    extractedText: preview.extractedText,
    extractedHtml: preview.extractedHtml,
    excerpt: preview.excerpt,
    byline: preview.byline,
    siteName: preview.siteName,
    source: 'web',
  };
}

export function hostLabel(url: string | null): string | null {
  if (url === null || url === '') return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function formatCapturedAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export type DayGroupKey = 'today' | 'yesterday' | 'week' | 'earlier';

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayGroupKey(iso: string, timeZone: string, now: Date = new Date()): DayGroupKey {
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = dayFmt.format(new Date(iso));
  if (day === dayFmt.format(now)) return 'today';
  if (day === dayFmt.format(new Date(now.getTime() - DAY_MS))) return 'yesterday';
  if (now.getTime() - new Date(iso).getTime() < 7 * DAY_MS) return 'week';
  return 'earlier';
}

export function groupSavesByDay(
  items: InboxItem[],
  timeZone: string,
): { key: DayGroupKey; items: InboxItem[] }[] {
  const order: DayGroupKey[] = ['today', 'yesterday', 'week', 'earlier'];
  const buckets = new Map<DayGroupKey, InboxItem[]>();
  for (const item of items) {
    const key = dayGroupKey(item.capturedAt, timeZone);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const groups: { key: DayGroupKey; items: InboxItem[] }[] = [];
  for (const key of order) {
    const bucket = buckets.get(key);
    if (bucket) groups.push({ key, items: bucket });
  }
  return groups;
}

export function statusLabelKey(
  status: InboxItem['status'],
): 'unread' | 'favorite' | 'archived' | 'converted' {
  if (status === 'later') return 'favorite';
  if (status === 'archived') return 'archived';
  if (status === 'converted') return 'converted';
  return 'unread';
}
