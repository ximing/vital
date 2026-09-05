import { describe, expect, it } from 'vitest';
import { createTaskInputSchema, patchTaskInputSchema, uncompleteTaskInputSchema } from './tasks.js';

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
