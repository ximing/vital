import { describe, expect, it } from 'vitest';
import {
  createTaskFromTextInputSchema,
  createTaskInputSchema,
  patchTaskInputSchema,
  uncompleteTaskInputSchema,
} from '../src/tasks.js';

describe('createTaskInputSchema', () => {
  it('requires title and list uuid; P0 is 0', () => {
    const parsed = createTaskInputSchema.parse({
      title: 'Buy milk',
      listId: '11111111-1111-4111-8111-111111111111',
      priority: 0,
    });
    expect(parsed.title).toBe('Buy milk');
    expect(parsed.priority).toBe(0);
    expect(createTaskInputSchema.safeParse({ title: 'x', listId: 'smart:today' }).success).toBe(
      false,
    );
  });

  it('accepts fixed recurrence and supported reminder presets', () => {
    const parsed = createTaskInputSchema.parse({
      title: '发送周报',
      listId: '11111111-1111-4111-8111-111111111111',
      reminderMode: 'offset',
      reminderOffsetMinutes: 15,
      recurrenceKind: 'legal_workdays',
    });
    expect(parsed.reminderOffsetMinutes).toBe(15);
    expect(parsed.recurrenceKind).toBe('legal_workdays');
  });

  it('rejects an unsupported reminder offset', () => {
    expect(
      createTaskInputSchema.safeParse({
        title: '发送周报',
        listId: '11111111-1111-4111-8111-111111111111',
        reminderMode: 'offset',
        reminderOffsetMinutes: 10,
      }).success,
    ).toBe(false);
  });
});

describe('patchTaskInputSchema', () => {
  it('omit vs null: empty rejected, dueAt null allowed', () => {
    expect(patchTaskInputSchema.safeParse({}).success).toBe(false);
    expect(patchTaskInputSchema.parse({ dueAt: null })).toEqual({ dueAt: null });
    expect(patchTaskInputSchema.parse({ tagIds: [] }).tagIds).toEqual([]);
  });
});

describe('uncompleteTaskInputSchema', () => {
  it('requires completionId', () => {
    expect(uncompleteTaskInputSchema.safeParse({}).success).toBe(false);
    expect(
      uncompleteTaskInputSchema.parse({ completionId: '11111111-1111-4111-8111-111111111111' })
        .completionId,
    ).toBe('11111111-1111-4111-8111-111111111111');
  });
});

describe('createTaskFromTextInputSchema', () => {
  it('requires text; accepts optional list and smart list', () => {
    const parsed = createTaskFromTextInputSchema.parse({
      text: '明天下午三点开会',
      listId: '11111111-1111-4111-8111-111111111111',
      smartListId: 'smart:today',
    });
    expect(parsed.text).toBe('明天下午三点开会');
    expect(createTaskFromTextInputSchema.safeParse({ text: '' }).success).toBe(false);
    expect(createTaskFromTextInputSchema.safeParse({ text: 'x', smartListId: 'smart:nope' }).success).toBe(
      false,
    );
  });
});
