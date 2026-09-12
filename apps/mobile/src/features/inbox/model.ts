import type { InboxItem, InboxSource } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';

export type InboxFilter = 'all' | 'unread' | 'favorite' | 'archived';

export function sourceTileColor(t: Theme, source: InboxSource): string {
  switch (source) {
    case 'extension':
      return t.srcExtension;
    case 'wechat':
      return t.srcWechat;
    case 'web':
      return t.srcWeb;
    case 'mobile':
      return t.srcMobile;
    case 'manual':
      return t.srcManual;
  }
}

export function tileLetter(item: InboxItem): string {
  const base = (item.siteName ?? item.title).trim();
  return (base[0] ?? '?').toUpperCase();
}

export function isFavorite(item: InboxItem): boolean {
  return item.status === 'later';
}

export function isUnread(item: InboxItem): boolean {
  return item.readAt === null && item.status === 'unread';
}

/** Aligned with web filterSaves: all = non-archived; favorite = status 'later'. */
export function filterInbox(items: InboxItem[], filter: InboxFilter): InboxItem[] {
  const live = items.filter((item) => item.deletedAt === null);
  const picked =
    filter === 'archived'
      ? live.filter((item) => item.status === 'archived')
      : filter === 'unread'
        ? live.filter((item) => item.status === 'unread')
        : filter === 'favorite'
          ? live.filter((item) => item.status === 'later')
          : live.filter((item) => item.status !== 'archived');
  return picked.slice().sort((a, b) => {
    if (a.createdAt === b.createdAt) return b.id.localeCompare(a.id);
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function unreadCount(items: InboxItem[]): number {
  return items.filter((item) => item.deletedAt === null && item.status === 'unread').length;
}

export type DayGroupKey = 'today' | 'yesterday' | 'week' | 'earlier';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayStamp(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Group by createdAt into 今天 / 昨天 / 本周 / 更早. */
export function groupByDay(
  items: InboxItem[],
  timeZone: string,
  now: Date = new Date(),
): { key: DayGroupKey; title: string; items: InboxItem[] }[] {
  const today = dayStamp(now, timeZone);
  const yesterday = dayStamp(new Date(now.getTime() - DAY_MS), timeZone);
  const buckets = new Map<DayGroupKey, InboxItem[]>();
  for (const item of items) {
    const at = new Date(item.createdAt);
    const stamp = dayStamp(at, timeZone);
    const key: DayGroupKey =
      stamp === today
        ? 'today'
        : stamp === yesterday
          ? 'yesterday'
          : now.getTime() - at.getTime() < 7 * DAY_MS
            ? 'week'
            : 'earlier';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const order: DayGroupKey[] = ['today', 'yesterday', 'week', 'earlier'];
  const groups: { key: DayGroupKey; title: string; items: InboxItem[] }[] = [];
  for (const key of order) {
    const bucket = buckets.get(key);
    if (bucket) groups.push({ key, title: copy.inbox.groups[key], items: bucket });
  }
  return groups;
}

function hm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function fill(template: string, n: number): string {
  return template.replace('{n}', String(n));
}

/** 相对时间：刚刚 / n 分钟前 / n 小时前 / 昨天 HH:mm / n 天前 / M月d日。 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const diff = now.getTime() - at.getTime();
  if (diff < 60 * 1000) return copy.inbox.relJustNow;
  if (diff < 60 * 60 * 1000) return fill(copy.inbox.relMinutes, Math.floor(diff / 60000));
  if (diff < DAY_MS) return fill(copy.inbox.relHours, Math.floor(diff / 3600000));
  const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const localAt = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const dayDiff = Math.round((localToday.getTime() - localAt.getTime()) / DAY_MS);
  if (dayDiff === 1) return `${copy.inbox.groups.yesterday} ${hm(at)}`;
  if (dayDiff < 7) return fill(copy.inbox.relDays, dayDiff);
  if (at.getFullYear() === now.getFullYear()) return `${at.getMonth() + 1}月${at.getDate()}日`;
  return `${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日`;
}
