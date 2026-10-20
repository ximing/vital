import { describe, expect, it } from 'vitest';
import { showsOnTodayBoard } from '../../src/outcomes/board.js';

describe('showsOnTodayBoard', () => {
  it('keeps a user thread even when it has no open work', () => {
    expect(showsOnTodayBoard({ createdBy: 'user', realOpen: 0, linkedHabits: 0 })).toBe(true);
  });

  it('keeps an agent thread that still has real work or a habit', () => {
    expect(showsOnTodayBoard({ createdBy: 'agent', realOpen: 1, linkedHabits: 0 })).toBe(true);
    expect(showsOnTodayBoard({ createdBy: 'agent', realOpen: 0, linkedHabits: 1 })).toBe(true);
  });

  it('hides an agent thread that is only a finished pile or a calendar', () => {
    expect(showsOnTodayBoard({ createdBy: 'agent', realOpen: 0, linkedHabits: 0 })).toBe(false);
  });
});
