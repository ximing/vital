import { describe, expect, it } from 'vitest';
import type { Task } from '@vital/dto';
import { compareTasks, MANUAL_TASK_SORT } from '../src/index.js';

function task(over: Pick<Task, 'id'> & Partial<Task>): Task {
  return {
    sortOrder: 0,
    title: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dueAt: null,
    ...over,
  } as Task;
}

describe('compareTasks', () => {
  it('sorts manual order by sortOrder and ignores direction', () => {
    const low = task({ id: 'b', sortOrder: 1 });
    const high = task({ id: 'a', sortOrder: 2 });
    const tied = task({ id: 'c', sortOrder: 1 });
    expect(compareTasks(low, high, MANUAL_TASK_SORT)).toBeLessThan(0);
    expect(compareTasks(low, high, { key: 'manual', dir: 'desc' })).toBeLessThan(0);
    expect(compareTasks(low, tied, { key: 'manual', dir: 'desc' })).toBe('b'.localeCompare('c'));
  });

  it('keeps missing due dates last when sorting soonest first', () => {
    const early = task({ id: 'a', dueAt: '2026-01-02T00:00:00.000Z' });
    const late = task({ id: 'b', dueAt: '2026-06-01T00:00:00.000Z' });
    const undated = task({ id: 'c', dueAt: null });
    const alsoUndated = task({ id: 'd', dueAt: null });
    const asc = { key: 'due' as const, dir: 'asc' as const };
    expect(compareTasks(early, late, asc)).toBeLessThan(0);
    expect(compareTasks(early, undated, asc)).toBeLessThan(0);
    expect(compareTasks(undated, late, asc)).toBeGreaterThan(0);
    expect(compareTasks(undated, alsoUndated, asc)).toBe('c'.localeCompare('d'));
  });

  it('compares titles with zh collation and breaks ties by id', () => {
    const beijing = task({ id: '2', title: '北京' });
    const shanghai = task({ id: '1', title: '上海' });
    const zh = '北京'.localeCompare('上海', 'zh');
    expect(zh).not.toBe(0);
    expect(compareTasks(beijing, shanghai, { key: 'title', dir: 'asc' })).toBe(zh);
    expect(compareTasks(beijing, shanghai, { key: 'title', dir: 'desc' })).toBe(-zh);
    const sameA = task({ id: 'b', title: '同名' });
    const sameB = task({ id: 'a', title: '同名' });
    expect(compareTasks(sameA, sameB, { key: 'title', dir: 'desc' })).toBe('b'.localeCompare('a'));
  });
});
