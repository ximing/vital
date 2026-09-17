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
  /** Owning thread (outcome). Habits contribute progress to that thread. */
  outcomeId: string | null;
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
    outcomeId: uuidSchema.optional(),
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
    outcomeId: uuidSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchHabitInput = z.infer<typeof patchHabitInputSchema>;

export const habitIdParamsSchema = z.object({
  id: uuidSchema,
});
export type HabitIdParams = z.infer<typeof habitIdParamsSchema>;

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const MS_PER_DAY = 24 * 3600 * 1000;

export const habitCheckinsQuerySchema = z
  .object({
    from: ymdSchema,
    to: ymdSchema,
  })
  .refine((value) => value.from <= value.to, { message: 'from must be <= to' })
  .refine((value) => {
    const start = Date.parse(`${value.from}T00:00:00.000Z`);
    const end = Date.parse(`${value.to}T00:00:00.000Z`);
    return Number.isFinite(start) && Number.isFinite(end) && end - start <= 366 * MS_PER_DAY;
  }, { message: 'range too long' });
export type HabitCheckinsQuery = z.infer<typeof habitCheckinsQuerySchema>;

export interface HabitCheckinDay {
  /** YYYY-MM-DD in the user's timezone (from habit_key). */
  date: string;
  /** Completed instances that day (count habits can be > 1). */
  done: number;
}

export interface HabitCheckin {
  habitId: string;
  days: HabitCheckinDay[];
}

export interface HabitCheckinsResponse {
  items: HabitCheckin[];
}
