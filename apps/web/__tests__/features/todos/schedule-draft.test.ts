import type { Task } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import {
  applyDraftToCreate,
  draftChip,
  draftFromTask,
  draftSummary,
  draftToPatch,
  emptyScheduleDraft,
} from '../../../src/features/todos/schedule-draft';

const TZ = 'Asia/Shanghai';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    listId: 'inbox-1',
    parentId: null,
    title: 'x',
    notes: '',
    status: 'todo',
    priority: 3,
    pinned: false,
    dueAt: '2026-09-08T01:00:00.000Z',
    startAt: null,
    reminderMode: 'none',
    reminderOffsetMinutes: null,
    reminderAt: null,
    isAllDay: false,
    timezone: TZ,
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

describe('schedule draft', () => {
  it('maps a timed due into point mode and back', () => {
    const draft = draftFromTask(task(), TZ);
    expect(draft.mode).toBe('point');
    expect(draft.startYmd).toBe('2026-09-08');
    expect(draft.startHm).toBe('09:00');
    expect(draft.endYmd).toBeNull();
    const patch = draftToPatch(draft, TZ);
    expect(patch.startAt).toBeNull();
    expect(patch.isAllDay).toBe(false);
    expect(patch.dueAt).toBe('2026-09-08T01:00:00.000Z');
  });

  it('maps start+due into range mode', () => {
    const draft = draftFromTask(
      task({
        startAt: '2026-09-07T16:00:00.000Z',
        dueAt: '2026-09-08T16:00:00.000Z',
        isAllDay: true,
      }),
      TZ,
    );
    expect(draft.mode).toBe('range');
    expect(draft.startYmd).toBe('2026-09-08');
    expect(draft.endYmd).toBe('2026-09-09');
    expect(draft.startHm).toBeNull();
    expect(draftSummary(draft, TZ)).toContain('–');
  });

  it('keeps create payload dates when the draft has no calendar pick', () => {
    const base = { title: 'x', listId: 'inbox-1', dueAt: 'keep', isAllDay: true };
    expect(applyDraftToCreate(base, emptyScheduleDraft(), TZ)).toEqual(base);
  });

  it('formats an overdue timed point as a chip', () => {
    const draft = draftFromTask(task({ dueAt: '2026-04-19T13:00:00.000Z' }), TZ);
    const chip = draftChip(draft, TZ, new Date('2026-09-07T00:00:00.000Z'));
    expect(draft.startYmd).toBe('2026-04-19');
    expect(draft.startHm).toBe('21:00');
    expect(chip.overdue).toBe(true);
    expect(chip.text).toBe('4月19日, 21:00, 延期141天');
  });

  it('never mixes recurrence and recurrenceKind in a patch', () => {
    const patch = draftToPatch(draftFromTask(task(), TZ), TZ);
    expect(patch).not.toHaveProperty('recurrence');
    expect(patch).toHaveProperty('recurrenceKind', null);
  });

  it('collapses a same-day all-day range to one date', () => {
    const draft = draftFromTask(
      task({
        startAt: '2026-09-06T16:00:00.000Z',
        dueAt: '2026-09-06T16:00:00.000Z',
        isAllDay: true,
      }),
      TZ,
    );
    expect(draft.mode).toBe('range');
    expect(draftChip(draft, TZ, new Date('2026-09-07T00:00:00.000Z')).text).toBe('9月7日');
  });
});
