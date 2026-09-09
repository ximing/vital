import { describe, expect, it } from 'vitest';
import {
  createListInputSchema,
  listIdSchema,
  patchListInputSchema,
  reorderListsInputSchema,
  SMART_LIST_IDS,
} from '../src/lists.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';

describe('listIdSchema', () => {
  it('accepts uuid and smart ids', () => {
    expect(listIdSchema.parse(UUID)).toBe(UUID);
    for (const id of SMART_LIST_IDS) {
      expect(listIdSchema.parse(id)).toBe(id);
    }
  });

  it('rejects unknown smart ids', () => {
    expect(listIdSchema.safeParse('smart:other').success).toBe(false);
    expect(listIdSchema.safeParse('not-a-list').success).toBe(false);
  });
});

describe('createListInputSchema', () => {
  it('accepts parentId and emoji icon', () => {
    expect(createListInputSchema.parse({ name: '工作', parentId: UUID, icon: '🔥' })).toEqual({
      name: '工作',
      parentId: UUID,
      icon: '🔥',
    });
  });

  it('rejects a smart parentId', () => {
    expect(createListInputSchema.safeParse({ name: '工作', parentId: 'smart:today' }).success).toBe(
      false,
    );
  });
});

describe('patchListInputSchema', () => {
  it('rejects empty patch; null clears color, icon, parent, and attachment', () => {
    expect(patchListInputSchema.safeParse({}).success).toBe(false);
    expect(patchListInputSchema.parse({ color: null })).toEqual({ color: null });
    expect(patchListInputSchema.parse({ parentId: null, icon: null, iconAttachmentId: null })).toEqual({
      parentId: null,
      icon: null,
      iconAttachmentId: null,
    });
  });
});

describe('reorderListsInputSchema', () => {
  it('scopes orderedIds to a parent (null = root)', () => {
    expect(reorderListsInputSchema.parse({ parentId: null, orderedIds: [UUID, CHILD] })).toEqual({
      parentId: null,
      orderedIds: [UUID, CHILD],
    });
    expect(reorderListsInputSchema.parse({ parentId: UUID, orderedIds: [CHILD] })).toEqual({
      parentId: UUID,
      orderedIds: [CHILD],
    });
  });

  it('rejects a missing parentId or empty orderedIds', () => {
    expect(reorderListsInputSchema.safeParse({ orderedIds: [UUID] }).success).toBe(false);
    expect(reorderListsInputSchema.safeParse({ parentId: null, orderedIds: [] }).success).toBe(false);
  });
});
