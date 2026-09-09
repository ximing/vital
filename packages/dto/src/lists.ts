import { z } from 'zod';

export const SMART_LIST_IDS = [
  'smart:inbox',
  'smart:today',
  'smart:upcoming',
  'smart:someday',
  'smart:done',
] as const;
export type SmartListId = (typeof SMART_LIST_IDS)[number];

export const smartListIdSchema = z.enum(SMART_LIST_IDS);
export const uuidSchema = z.string().uuid();

export const listIdSchema = z.union([uuidSchema, smartListIdSchema]);
export type ListId = z.infer<typeof listIdSchema>;

export const persistedListKindSchema = z.enum(['user', 'inbox']);
export type PersistedListKind = z.infer<typeof persistedListKindSchema>;

export const listKindSchema = z.enum(['user', 'inbox', 'smart']);
export type ListKind = z.infer<typeof listKindSchema>;

export interface List {
  id: string;
  kind: ListKind;
  name: string;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export const createListInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(16).optional(),
  icon: z.string().trim().min(1).max(32).optional(),
});
export type CreateListInput = z.infer<typeof createListInputSchema>;

export const patchListInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    color: z.string().trim().min(1).max(16).nullable().optional(),
    icon: z.string().trim().min(1).max(32).nullable().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchListInput = z.infer<typeof patchListInputSchema>;

export const reorderListsInputSchema = z.object({
  orderedIds: z.array(uuidSchema).min(1),
});
export type ReorderListsInput = z.infer<typeof reorderListsInputSchema>;

export interface ListCollection {
  items: List[];
}
