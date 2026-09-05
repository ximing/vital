import { z } from 'zod';
import { uuidSchema } from './lists.js';

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export const createTagInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(16).optional(),
});
export type CreateTagInput = z.infer<typeof createTagInputSchema>;

export const patchTagInputSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: z.string().trim().min(1).max(16).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchTagInput = z.infer<typeof patchTagInputSchema>;

export const tagIdsSchema = z.array(uuidSchema);

export interface TagCollection {
  items: Tag[];
}
