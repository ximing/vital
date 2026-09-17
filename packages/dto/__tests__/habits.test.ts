import { describe, expect, it } from 'vitest';
import { createHabitInputSchema, habitCheckinsQuerySchema } from '../src/habits.js';

describe('habitCheckinsQuerySchema', () => {
  it('accepts a closed ymd range', () => {
    expect(habitCheckinsQuerySchema.parse({ from: '2026-09-01', to: '2026-09-30' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('rejects inverted or overlong ranges', () => {
    expect(habitCheckinsQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(
      false,
    );
    expect(habitCheckinsQuerySchema.safeParse({ from: '2025-01-01', to: '2026-12-31' }).success).toBe(
      false,
    );
    expect(habitCheckinsQuerySchema.safeParse({ from: '09-01', to: '2026-09-30' }).success).toBe(
      false,
    );
  });
});

describe('createHabitInputSchema', () => {
  it('requires targetCount for count habits', () => {
    expect(
      createHabitInputSchema.safeParse({ name: '喝水', kind: 'count' }).success,
    ).toBe(false);
    expect(
      createHabitInputSchema.parse({ name: '喝水', kind: 'count', targetCount: 8 }),
    ).toMatchObject({ kind: 'count', targetCount: 8 });
  });
});
