import { z } from 'zod';
import { ianaTimezoneSchema } from './auth.js';
import { listIdSchema, uuidSchema } from './lists.js';
import { tagIdsSchema } from './tags.js';

export const taskStatusSchema = z.enum(['todo', 'doing', 'done', 'canceled']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskPrioritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const timeBucketSchema = z.enum(['dated', 'anytime', 'someday']);
export type TimeBucket = z.infer<typeof timeBucketSchema>;

export const reminderModeSchema = z.enum(['none', 'due', 'offset', 'custom']);
export type ReminderMode = z.infer<typeof reminderModeSchema>;

export const reminderOffsetMinutesSchema = z.union([
  z.literal(5),
  z.literal(15),
  z.literal(30),
  z.literal(60),
  z.literal(1440),
]);
export type ReminderOffsetMinutes = z.infer<typeof reminderOffsetMinutesSchema>;

export const recurrenceKindSchema = z.enum([
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'weekdays',
  'weekends',
  'holidays',
  'legal_workdays',
]);
export type RecurrenceKind = z.infer<typeof recurrenceKindSchema>;

const isoDateTimeSchema = z.string().datetime({ offset: true });

export interface Task {
  id: string;
  listId: string;
  parentId: string | null;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  startAt: string | null;
  reminderMode: ReminderMode | null;
  reminderOffsetMinutes: ReminderOffsetMinutes | null;
  reminderAt: string | null;
  isAllDay: boolean;
  timezone: string;
  timeBucket: TimeBucket;
  recurrence: string | null;
  recurrenceKind: RecurrenceKind | null;
  recurrenceDtstart: string | null;
  completedAt: string | null;
  sortOrder: number;
  tagIds: string[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCollection {
  items: Task[];
  nextCursor: string | null;
}

export interface CompleteTaskResponse {
  task: Task;
  undo: { completionId: string };
}

export const uncompleteTaskInputSchema = z.object({
  completionId: uuidSchema,
});
export type UncompleteTaskInput = z.infer<typeof uncompleteTaskInputSchema>;

export const createTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  listId: uuidSchema,
  parentId: uuidSchema.nullable().optional(),
  notes: z.string().max(50_000).optional(),
  status: z.enum(['todo', 'doing', 'canceled']).optional(),
  priority: taskPrioritySchema.optional(),
  dueAt: isoDateTimeSchema.nullable().optional(),
  startAt: isoDateTimeSchema.nullable().optional(),
  reminderMode: reminderModeSchema.optional(),
  reminderOffsetMinutes: reminderOffsetMinutesSchema.nullable().optional(),
  reminderAt: isoDateTimeSchema.nullable().optional(),
  isAllDay: z.boolean().optional(),
  timezone: ianaTimezoneSchema.optional(),
  timeBucket: timeBucketSchema.optional(),
  recurrence: z.string().trim().min(1).max(500).nullable().optional(),
  recurrenceKind: recurrenceKindSchema.nullable().optional(),
  tagIds: tagIdsSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.reminderMode === 'offset' && value.reminderOffsetMinutes === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reminderOffsetMinutes'], message: 'offset required' });
  }
  if (value.reminderMode === 'custom' && value.reminderAt === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reminderAt'], message: 'custom reminder required' });
  }
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const patchTaskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    listId: uuidSchema.optional(),
    notes: z.string().max(50_000).nullable().optional(),
    status: z.enum(['todo', 'doing', 'canceled']).optional(),
    priority: taskPrioritySchema.optional(),
    dueAt: isoDateTimeSchema.nullable().optional(),
    startAt: isoDateTimeSchema.nullable().optional(),
    reminderMode: reminderModeSchema.nullable().optional(),
    reminderOffsetMinutes: reminderOffsetMinutesSchema.nullable().optional(),
    reminderAt: isoDateTimeSchema.nullable().optional(),
    isAllDay: z.boolean().optional(),
    timezone: ianaTimezoneSchema.optional(),
    timeBucket: timeBucketSchema.optional(),
    recurrence: z.string().trim().min(1).max(500).nullable().optional(),
    recurrenceKind: recurrenceKindSchema.nullable().optional(),
    tagIds: tagIdsSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchTaskInput = z.infer<typeof patchTaskInputSchema>;

export const listTasksQuerySchema = z.object({
  listId: listIdSchema,
  cursor: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? 50 : Number(value)))
    .pipe(z.number().int().min(1).max(100)),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const calendarQuerySchema = z.object({
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export interface CalendarInstance {
  taskId: string;
  listId: string;
  title: string;
  occurrenceAt: string;
  isAllDay: boolean;
  status: TaskStatus;
  priority: TaskPriority;
}

export interface CalendarResponse {
  instances: CalendarInstance[];
}

export const reorderTasksInputSchema = z.object({
  listId: uuidSchema,
  parentId: uuidSchema.nullable().optional(),
  orderedIds: z.array(uuidSchema).min(1),
});
export type ReorderTasksInput = z.infer<typeof reorderTasksInputSchema>;
