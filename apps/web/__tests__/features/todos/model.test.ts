import type { List, Task } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import {
  applyOptimisticComplete,
  countWithDescendants,
  createPayload,
  descendantListIds,
  emptyCopyKey,
  filterTasks,
  formatYmd,
  isDueSoon,
  isOverdue,
  listChildren,
  listRoots,
  listSections,
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

function makeList(over: Partial<List> & Pick<List, 'id' | 'name'>): List {
  return {
    kind: 'user',
    color: null,
    icon: null,
    iconAttachmentId: null,
    iconUrl: null,
    parentId: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function makeTask(over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    listId: 'inbox-1',
    parentId: null,
    notes: '',
    status: 'todo',
    priority: 3,
    pinned: false,
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

  it('builds a depth-2 list tree and sums descendant counts', () => {
    const parent = makeList({ id: 'p', name: '父', sortOrder: 1 });
    const child = makeList({ id: 'c', name: '子', parentId: 'p', sortOrder: 1 });
    const other = makeList({ id: 'o', name: '其它', sortOrder: 2 });
    const lists = [parent, child, other];
    expect(listRoots(lists).map((item) => item.id)).toEqual(['p', 'o']);
    expect(listChildren(lists, 'p').map((item) => item.id)).toEqual(['c']);
    expect(descendantListIds(lists, 'p')).toEqual(['p', 'c']);
    expect(countWithDescendants({ p: 2, c: 3, o: 1 }, lists, 'p')).toBe(5);
  });

  it('sections a parent list by own tasks then children', () => {
    const parent = makeList({ id: 'p', name: '父' });
    const child = makeList({ id: 'c', name: '子', parentId: 'p' });
    const sections = listSections(
      'p',
      [
        makeTask({ id: 't1', title: '父任务', listId: 'p' }),
        makeTask({ id: 't2', title: '子任务', listId: 'c' }),
      ],
      TZ,
      NOW,
      [parent, child],
    );
    expect(sections.map((section) => section.listName ?? section.heading)).toEqual(['本集合', '子']);
    expect(sections[0]?.nodes[0]?.task.id).toBe('t1');
    expect(sections[1]?.nodes[0]?.task.id).toBe('t2');
  });

  it('floats pinned tasks to the top of today, a user list, and a parent collection', () => {
    const pinnedToday = makeTask({
      id: 'pin',
      title: '钉住',
      pinned: true,
      sortOrder: 9,
      dueAt: zonedLocalMidnightIso('2026-09-06', TZ),
    });
    const overdueTask = makeTask({
      id: 'over',
      title: '逾期',
      dueAt: zonedLocalMidnightIso('2026-09-05', TZ),
      sortOrder: 1,
    });
    const todayTask = makeTask({
      id: 'now',
      title: '今天',
      dueAt: zonedLocalMidnightIso('2026-09-06', TZ),
      sortOrder: 2,
    });
    expect(listVisibleIds('smart:today', [todayTask, overdueTask, pinnedToday], TZ, NOW)).toEqual([
      'pin',
      'over',
      'now',
    ]);

    const plain = makeTask({ id: 'a', title: '普通', listId: 'l1', sortOrder: 1 });
    const pinned = makeTask({ id: 'b', title: '置顶', listId: 'l1', pinned: true, sortOrder: 2 });
    const userSections = listSections('l1', [plain, pinned], TZ, NOW);
    expect(userSections.map((section) => section.heading)).toEqual(['pinned', null]);
    expect(userSections[0]?.nodes[0]?.task.id).toBe('b');
    expect(userSections[1]?.nodes[0]?.task.id).toBe('a');

    const parent = makeList({ id: 'p', name: '父' });
    const child = makeList({ id: 'c', name: '子', parentId: 'p' });
    const parentSections = listSections(
      'p',
      [
        makeTask({ id: 't1', title: '父任务', listId: 'p' }),
        makeTask({ id: 't2', title: '子任务', listId: 'c', pinned: true }),
      ],
      TZ,
      NOW,
      [parent, child],
    );
    expect(parentSections[0]?.heading).toBe('pinned');
    expect(parentSections[0]?.nodes[0]?.task.id).toBe('t2');
  });
});
