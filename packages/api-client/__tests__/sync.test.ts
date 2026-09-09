import type { InboxItem, ReportListItem, Task } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import {
  latestUpdatedAt,
  mergeInboxItems,
  mergeReportListItems,
  mergeTasksIntoList,
  syncEventsUrl,
  syncHeadMoved,
} from '../src/sync.js';

const task = (over: Partial<Task> & Pick<Task, 'id' | 'listId'>): Task => ({
  parentId: null,
  title: 't',
  notes: '',
  status: 'todo',
  priority: 3,
  dueAt: null,
  startAt: null,
  reminderMode: null,
  reminderOffsetMinutes: null,
  reminderAt: null,
  isAllDay: false,
  timezone: 'UTC',
  recurrence: null,
  recurrenceKind: null,
  recurrenceDtstart: null,
  completedAt: null,
  sortOrder: 0,
  tagIds: [],
  deletedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

const inbox = (over: Partial<InboxItem> & Pick<InboxItem, 'id'>): InboxItem => ({
  title: 'n',
  originalUrl: null,
  canonicalUrl: null,
  extractedText: null,
  extractedHtml: null,
  excerpt: null,
  byline: null,
  siteName: null,
  status: 'unread',
  source: 'manual',
  capturedAt: '2026-09-01T00:00:00.000Z',
  readAt: null,
  convertedTaskId: null,
  assets: [],
  deletedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

const report = (over: Partial<ReportListItem> & Pick<ReportListItem, 'id'>): ReportListItem => ({
  type: 'daily',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-02',
  title: '日报',
  revision: 1,
  snapshotAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('syncEventsUrl', () => {
  it('uses the page host when baseUrl is empty (cookie web)', () => {
    expect(syncEventsUrl('', { protocol: 'http:', host: '127.0.0.1:5180' })).toBe(
      'ws://127.0.0.1:5180/api/v1/sync/events',
    );
    expect(syncEventsUrl('', { protocol: 'https:', host: 'vital.aimo.plus' })).toBe(
      'wss://vital.aimo.plus/api/v1/sync/events',
    );
  });

  it('rewrites an absolute API base (Tauri / mobile)', () => {
    expect(syncEventsUrl('http://127.0.0.1:3010')).toBe('ws://127.0.0.1:3010/api/v1/sync/events');
    expect(syncEventsUrl('https://vital.aimo.plus')).toBe('wss://vital.aimo.plus/api/v1/sync/events');
  });
});

describe('syncHeadMoved', () => {
  const head = {
    tasksMaxUpdatedAt: 't1',
    inboxMaxUpdatedAt: 'i1',
    reportsMaxUpdatedAt: 'r1',
    revision: 1,
  };
  it('treats a missing prev as moved', () => {
    expect(syncHeadMoved(null, head)).toBe(true);
  });
  it('detects watermark and revision changes', () => {
    expect(syncHeadMoved(head, head)).toBe(false);
    expect(syncHeadMoved(head, { ...head, tasksMaxUpdatedAt: 't2' })).toBe(true);
    expect(syncHeadMoved(head, { ...head, revision: 2 })).toBe(true);
  });
});

describe('mergeTasksIntoList', () => {
  it('upserts, drops tombstones, and removes tasks that left the list', () => {
    const a = task({ id: 'a', listId: 'L', title: 'old' });
    const b = task({ id: 'b', listId: 'L' });
    const updated = task({ id: 'a', listId: 'L', title: 'new' });
    const gone = task({ id: 'b', listId: 'L', deletedAt: '2026-09-02T00:00:00.000Z' });
    const moved = task({ id: 'c', listId: 'OTHER' });
    expect(mergeTasksIntoList([a, b], [updated, gone, moved], 'L').map((row) => row.id)).toEqual([
      'a',
    ]);
    expect(mergeTasksIntoList([a], [updated], 'L')[0]?.title).toBe('new');
  });

  it('does not insert into smart lists; still updates and deletes known rows', () => {
    const a = task({ id: 'a', listId: 'L', title: 'old' });
    const created = task({ id: 'n', listId: 'L' });
    const updated = task({ id: 'a', listId: 'L', title: 'new' });
    expect(mergeTasksIntoList([a], [created, updated], 'smart:today').map((row) => row.title)).toEqual(
      ['new'],
    );
  });
});

describe('mergeInboxItems + reports + latestUpdatedAt', () => {
  it('drops archived and deleted inbox rows', () => {
    const a = inbox({ id: 'a' });
    const b = inbox({ id: 'b' });
    const archived = inbox({ id: 'a', status: 'archived' });
    const deleted = inbox({ id: 'b', deletedAt: '2026-09-02T00:00:00.000Z' });
    expect(mergeInboxItems([a, b], [archived, deleted])).toEqual([]);
  });

  it('upserts report list items and picks the latest updatedAt', () => {
    const a = report({ id: 'a', revision: 1, updatedAt: '2026-09-01T00:00:00.000Z' });
    const b = report({ id: 'a', revision: 2, updatedAt: '2026-09-02T00:00:00.000Z' });
    expect(mergeReportListItems([a], [b])[0]?.revision).toBe(2);
    expect(
      latestUpdatedAt({
        tasks: [task({ id: 't', listId: 'L', updatedAt: '2026-09-01T00:00:00.000Z' })],
        inbox: [],
        reports: [b],
      }),
    ).toBe('2026-09-02T00:00:00.000Z');
  });
});
