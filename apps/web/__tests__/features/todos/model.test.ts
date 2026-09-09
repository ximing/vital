import type { Task } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import {
  applyOptimisticComplete,
  createPayload,
  emptyCopyKey,
  filterTasks,
  formatYmd,
  isDueSoon,
  isOverdue,
  listVisibleIds,
  nestTasks,
  orderedAfterDrop,
  partitionToday,
  startOfWeekYmd,
  todayYmd,
  weekYmids,
  zonedLocalMidnightIso,
} from '../../../src/features/todos/model';

const TZ = 'Asia/Shanghai';
const NOW = new Date('2026-09-06T00:00:00.000Z'); // 08:00 in Shanghai

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

describe('todo model', () => {
  it('maps local midnight in Asia/Shanghai to UTC', () => {
    expect(zonedLocalMidnightIso('2026-09-06', TZ)).toBe('2026-09-05T16:00:00.000Z');
  });

  it('keeps America/Los_Angeles spring-forward midnight on the local date', () => {
    expect(zonedLocalMidnightIso('2026-03-08', 'America/Los_Angeles')).toBe(
      '2026-03-08T08:00:00.000Z',
    );
  });

  it('treats all-day due today as today, not overdue', () => {
    const todayTask = makeTask({
      id: 't1',
      title: '今天',
      dueAt: zonedLocalMidnightIso('2026-09-06', TZ),
    });
    const overdueTask = makeTask({
      id: 't0',
      title: '逾期',
      dueAt: zonedLocalMidnightIso('2026-09-05', TZ),
    });
    expect(todayYmd(TZ, NOW)).toBe('2026-09-06');
    expect(isOverdue(todayTask, TZ, NOW)).toBe(false);
    expect(isOverdue(overdueTask, TZ, NOW)).toBe(true);
    expect(isDueSoon(todayTask, TZ, NOW)).toBe(true);
  });

  it('partitions Today into overdue then today', () => {
    const nodes = nestTasks([
      makeTask({
        id: 'a',
        title: '逾期',
        dueAt: zonedLocalMidnightIso('2026-09-05', TZ),
        sortOrder: 1,
      }),
      makeTask({
        id: 'b',
        title: '今天',
        dueAt: zonedLocalMidnightIso('2026-09-06', TZ),
        sortOrder: 2,
      }),
    ]);
    const { overdue, today } = partitionToday(nodes, TZ, NOW);
    expect(overdue.map((n) => n.task.id)).toEqual(['a']);
    expect(today.map((n) => n.task.id)).toEqual(['b']);
  });

  it('listVisibleIds walks overdue then today even when today has lower sortOrder', () => {
    const todayTask = makeTask({
      id: 'now',
      title: '今天要做',
      dueAt: zonedLocalMidnightIso('2026-09-06', TZ),
      sortOrder: 1,
    });
    const overdueTask = makeTask({
      id: 'over',
      title: '昨天没做完',
      dueAt: zonedLocalMidnightIso('2026-09-05', TZ),
      sortOrder: 2,
    });
    expect(listVisibleIds('smart:today', [todayTask, overdueTask], TZ, NOW)).toEqual([
      'over',
      'now',
    ]);
  });

  it('starts the week on Monday when weekStartsOn is 1', () => {
    expect(startOfWeekYmd('2026-09-06', 1, TZ)).toBe('2026-08-31');
    expect(weekYmids('2026-09-06', 1, TZ)[0]).toBe('2026-08-31');
    expect(weekYmids('2026-09-06', 0, TZ)[0]).toBe('2026-09-06');
  });

  it('creates today tasks as all-day due in the inbox', () => {
    const payload = createPayload('写日报', 'smart:today', 'inbox-1', TZ, NOW);
    expect(payload.listId).toBe('inbox-1');
    expect(payload.isAllDay).toBe(true);
    expect(payload.dueAt).toBe(zonedLocalMidnightIso('2026-09-06', TZ));
  });

  it('creates a task on a picked calendar day', () => {
    const payload = createPayload('周会', 'smart:today', 'inbox-1', TZ, NOW, '2026-09-08');
    expect(payload.dueAt).toBe(zonedLocalMidnightIso('2026-09-08', TZ));
    expect(payload.isAllDay).toBe(true);
  });

  it('creates someday tasks with no dates', () => {
    const payload = createPayload('以后再说', 'smart:someday', 'inbox-1', TZ, NOW);
    expect(payload.dueAt).toBeNull();
    expect(payload.startAt).toBeNull();
  });

  it('reorders siblings before the drop target', () => {
    expect(orderedAfterDrop(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });

  it('filters by title and keeps the parent', () => {
    const parent = makeTask({ id: 'p', title: '项目', sortOrder: 1 });
    const child = makeTask({ id: 'c', title: '子任务细节', parentId: 'p', sortOrder: 2 });
    const other = makeTask({ id: 'o', title: '无关', sortOrder: 3 });
    const kept = filterTasks([parent, child, other], '细节');
    expect(kept.map((item) => item.id).sort()).toEqual(['c', 'p']);
  });

  it('hides optimistic completes unless undo is pending', () => {
    const items = [makeTask({ id: 'a', title: 'A' }), makeTask({ id: 'b', title: 'B' })];
    expect(applyOptimisticComplete(items, new Set(['a']), null).map((i) => i.id)).toEqual(['b']);
    expect(applyOptimisticComplete(items, new Set(['a']), 'a').map((i) => i.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('maps empty copy keys from spec screens', () => {
    expect(emptyCopyKey('smart:today')).toBe('today');
    expect(emptyCopyKey('smart:inbox')).toBe('inboxList');
    expect(emptyCopyKey('uuid-list')).toBe('userList');
  });

  it('formats ymd in the given zone', () => {
    expect(formatYmd(new Date('2026-09-05T16:00:00.000Z'), TZ)).toBe('2026-09-06');
  });
});
