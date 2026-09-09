import { z } from 'zod';
import { uuidSchema } from './lists.js';

export const habitKindSchema = z.enum(['daily', 'count']);
export type HabitKind = z.infer<typeof habitKindSchema>;

export const habitCreatedBySchema = z.enum(['user', 'agent']);
export type HabitCreatedBy = z.infer<typeof habitCreatedBySchema>;

const hmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'INVALID_HM' });

export interface Habit {
  id: string;
  name: string;
  kind: HabitKind;
  /** Required for kind='count' (e.g. 8 glasses of water). */
  targetCount: number | null;
  /** 'HH:mm' local window; outside it no instances are spawned. */
  windowStart: string | null;
  windowEnd: string | null;
  active: boolean;
  createdBy: HabitCreatedBy;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Computed at read time for the dashboard. */
  todayDone: number;
  todayTotal: number;
}

export const createHabitInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: habitKindSchema,
    targetCount: z.number().int().min(1).max(99).optional(),
    windowStart: hmSchema.optional(),
    windowEnd: hmSchema.optional(),
  })
  .refine((value) => value.kind !== 'count' || value.targetCount !== undefined, {
    message: 'targetCount required for count habits',
  });
export type CreateHabitInput = z.infer<typeof createHabitInputSchema>;

export const patchHabitInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    targetCount: z.number().int().min(1).max(99).nullable().optional(),
    windowStart: hmSchema.nullable().optional(),
    windowEnd: hmSchema.nullable().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchHabitInput = z.infer<typeof patchHabitInputSchema>;

export const habitIdParamsSchema = z.object({
  id: uuidSchema,
});
export type HabitIdParams = z.infer<typeof habitIdParamsSchema>;
