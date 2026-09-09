import type { InboxItem, ReportListItem, SyncChanges, SyncHead, Task } from '@vital/dto';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { inboxKeys } from '../../../src/features/inbox/queries';
import { reportKeys } from '../../../src/features/reports/queries';
import { applySyncChanges } from '../../../src/features/sync/apply-changes';
import { todoKeys } from '../../../src/features/todos/queries';

const HEAD: SyncHead = {
  tasksMaxUpdatedAt: 't',
  inboxMaxUpdatedAt: 'i',
  reportsMaxUpdatedAt: 'r',
  revision: 1,
};

function task(over: Partial<Task> & Pick<Task, 'id' | 'listId'>): Task {
  return {
    parentId: null,
    outcomeId: null,
    estimateMinutes: null,
    deferCount: 0,
    habitId: null,
    habitSeq: null,
    title: 't',
    notes: '',
    status: 'todo',
    priority: 3,
    pinned: false,
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
  };
}

function inbox(over: Partial<InboxItem> & Pick<InboxItem, 'id'>): InboxItem {
  return {
    title: 'n',
    outcomeId: null,
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
    tagIds: [],
    assets: [],
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function report(over: Partial<ReportListItem> & Pick<ReportListItem, 'id'>): ReportListItem {
  return {
    type: 'daily',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-02',
    title: '日报',
    revision: 1,
    snapshotAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function changes(over: Partial<SyncChanges> = {}): SyncChanges {
  return {
    serverTime: '2026-09-02T00:00:00.000Z',
    head: HEAD,
    tasks: [],
    inbox: [],
    reports: [],
    truncated: false,
    ...over,
  };
}

describe('applySyncChanges', () => {
  it('merges concrete task lists, invalidates smart lists, and never writes report bodies', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    qc.setQueryData(todoKeys.tasks('list-1'), [task({ id: 'a', listId: 'list-1', title: 'old' })]);
    qc.setQueryData(todoKeys.tasks('smart:today'), [task({ id: 'a', listId: 'list-1' })]);
    qc.setQueryData(inboxKeys.list, [inbox({ id: 'i1', title: 'old' })]);
    qc.setQueryData(reportKeys.list('daily'), [report({ id: 'r1', revision: 1 })]);
    qc.setQueryData(reportKeys.item('r1'), { id: 'r1', bodyMd: 'keep', revision: 1 });

    applySyncChanges(
      qc,
      changes({
        tasks: [
          task({ id: 'a', listId: 'list-1', title: 'new' }),
          task({ id: 'b', listId: 'list-1' }),
        ],
        inbox: [inbox({ id: 'i1', title: 'next' })],
        reports: [report({ id: 'r1', revision: 2, title: '新标题' })],
      }),
    );

    expect(qc.getQueryData<Task[]>(todoKeys.tasks('list-1'))?.map((row) => row.id)).toEqual([
      'b',
      'a',
    ]);
    expect(qc.getQueryData<Task[]>(todoKeys.tasks('list-1'))?.find((row) => row.id === 'a')?.title).toBe(
      'new',
    );
    expect(qc.getQueryData<InboxItem[]>(inboxKeys.list)?.[0]?.title).toBe('next');
    expect(qc.getQueryData<ReportListItem[]>(reportKeys.list('daily'))?.[0]?.revision).toBe(2);
    expect(qc.getQueryData<{ bodyMd: string }>(reportKeys.item('r1'))?.bodyMd).toBe('keep');
    expect(invalidate).toHaveBeenCalled();
  });

  it('removes deleted inbox items from the list and item cache', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const item = inbox({ id: 'i1' });
    qc.setQueryData(inboxKeys.list, [item]);
    qc.setQueryData(inboxKeys.item('i1'), item);
    applySyncChanges(
      qc,
      changes({ inbox: [inbox({ id: 'i1', deletedAt: '2026-09-02T00:00:00.000Z' })] }),
    );
    expect(qc.getQueryData<InboxItem[]>(inboxKeys.list)).toEqual([]);
    expect(qc.getQueryData(inboxKeys.item('i1'))).toBeUndefined();
  });
});
