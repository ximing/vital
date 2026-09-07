import type { InboxItem, InboxPreview, Task } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import {
  createInputFromPreview,
  hostLabel,
  normalizePasteUrl,
  pendingIdForUrl,
  unprocessedTodos,
  visibleSaves,
} from '../../../src/features/inbox/model';

const TZ = 'Asia/Shanghai';

function makeTask(over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    listId: 'inbox-1',
    parentId: null,
    notes: '',
    status: 'todo',
    priority: 3,
    dueAt: null,
    startAt: null,
    reminderMode: null,
    reminderOffsetMinutes: null,
    reminderAt: null,
    isAllDay: true,
    timezone: TZ,
    timeBucket: 'dated',
    recurrence: null,
    recurrenceKind: null,
    recurrenceDtstart: null,
    completedAt: null,
    sortOrder: 1024,
    tagIds: [],
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function makeItem(over: Partial<InboxItem> & Pick<InboxItem, 'id' | 'title'>): InboxItem {
  return {
    originalUrl: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    extractedText: 'Hello',
    extractedHtml: '<p>Hello</p>',
    excerpt: 'Hello',
    byline: null,
    siteName: 'example.com',
    status: 'unread',
    source: 'web',
    capturedAt: '2026-09-06T00:00:00.000Z',
    readAt: null,
    convertedTaskId: null,
    assets: [],
    deletedAt: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    ...over,
  };
}

describe('normalizePasteUrl', () => {
  it('accepts http(s) and fills https for bare hosts', () => {
    expect(normalizePasteUrl('https://Example.com/a')).toBe('https://Example.com/a');
    expect(normalizePasteUrl('example.com/a')).toBe('https://example.com/a');
    expect(normalizePasteUrl('file:///etc/passwd')).toBeNull();
    expect(normalizePasteUrl('just a note')).toBeNull();
  });
});

describe('unprocessedTodos / visibleSaves', () => {
  it('keeps open root tasks and drops archived saves', () => {
    const open = makeTask({ id: 't1', title: '开', sortOrder: 2 });
    const child = makeTask({ id: 't2', title: '子', parentId: 't1', sortOrder: 1 });
    const done = makeTask({ id: 't3', title: '完', status: 'done', sortOrder: 0 });
    expect(unprocessedTodos([done, child, open]).map((task) => task.id)).toEqual(['t1']);

    const unread = makeItem({ id: 'a', title: 'A', capturedAt: '2026-09-06T02:00:00.000Z' });
    const later = makeItem({
      id: 'b',
      title: 'B',
      status: 'later',
      capturedAt: '2026-09-06T01:00:00.000Z',
    });
    const archived = makeItem({ id: 'c', title: 'C', status: 'archived' });
    expect(visibleSaves([archived, later, unread]).map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('createInputFromPreview', () => {
  it('keeps originalUrl and web source', () => {
    const preview: InboxPreview = {
      title: 'Example Domain',
      originalUrl: 'https://example.com/a',
      canonicalUrl: 'https://example.com/a',
      extractedText: 'Hello',
      extractedHtml: '<p>Hello</p>',
      excerpt: 'Hello',
      byline: null,
      siteName: 'example.com',
      status: 'unread',
      source: 'web',
      readAt: null,
      convertedTaskId: null,
      assets: [],
    };
    expect(createInputFromPreview(preview, '  New  ')).toEqual({
      title: 'New',
      originalUrl: 'https://example.com/a',
      extractedText: 'Hello',
      extractedHtml: '<p>Hello</p>',
      excerpt: 'Hello',
      byline: null,
      siteName: 'example.com',
      source: 'web',
    });
    expect(pendingIdForUrl('https://example.com/a')).toBe('url:https://example.com/a');
    expect(hostLabel('https://www.example.com/a')).toBe('example.com');
  });
});
