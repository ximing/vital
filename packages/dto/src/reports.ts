import { z } from 'zod';
import type { InboxStatus } from './inbox.js';
import { uuidSchema } from './lists.js';
import { reportTypeSchema, type ReportType } from './reportTemplates.js';
import type { TaskPriority, TaskStatus } from './tasks.js';

export interface ReportTaskEmbed {
  id: string;
  title: string;
  status: TaskStatus;
  deletedAt: string | null;
}

export interface ReportInboxEmbed {
  id: string;
  title: string;
  status: InboxStatus;
  deletedAt: string | null;
}

export interface ReportEmbeds {
  tasks: Record<string, ReportTaskEmbed>;
  inbox: Record<string, ReportInboxEmbed>;
}

/** Carried task frozen at period close — the facts as of freeze time. */
export interface ReportSnapshotCarriedTask {
  taskId: string;
  title: string;
  priority: TaskPriority;
  dueAt: string | null;
  listId: string;
}

export interface ReportSnapshot {
  title: string;
  bodyMd: string;
  revision: number;
  embeds: ReportEmbeds;
  /** Open tasks carried out of the period, frozen when the period closed. */
  carried: ReportSnapshotCarriedTask[];
}

export interface ReportListItem {
  id: string;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  title: string;
  revision: number;
  snapshotAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Report extends ReportListItem {
  bodyMd: string;
  embeds: ReportEmbeds;
}

export interface ReportCollection {
  items: ReportListItem[];
  nextCursor: string | null;
}

export interface ReportEmbedsResponse {
  revision: number;
  embeds: ReportEmbeds;
}

export type ReportTypeCounts = Record<ReportType, number>;

const limitSchema = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? 50 : Number(value)))
  .pipe(z.number().int().min(1).max(100));

export const listReportsQuerySchema = z.object({
  type: reportTypeSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: limitSchema,
});
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

export const currentReportQuerySchema = z.object({
  type: reportTypeSchema,
  at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type CurrentReportQuery = z.infer<typeof currentReportQuerySchema>;

export const getReportQuerySchema = z.object({
  asOf: z.enum(['live', 'snapshot']).optional(),
});
export type GetReportQuery = z.infer<typeof getReportQuerySchema>;

export const patchReportInputSchema = z
  .object({
    revision: z.number().int().min(1),
    bodyMd: z.string().max(500_000).optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((value) => value.bodyMd !== undefined || value.title !== undefined, {
    message: 'at least one field required',
  });
export type PatchReportInput = z.infer<typeof patchReportInputSchema>;

export const fillReportInputSchema = z.object({
  revision: z.number().int().min(1),
});
export type FillReportInput = z.infer<typeof fillReportInputSchema>;

export const reportIdParamsSchema = z.object({
  id: uuidSchema,
});

export const reportOverviewQuerySchema = currentReportQuerySchema;
export type ReportOverviewQuery = CurrentReportQuery;

export interface ReportPeriodRef {
  start: string;
  end: string;
  label: string;
}

export interface ReportHeatCell {
  date: string;
  completed: number;
  wrote: boolean;
}

export interface ReportRecentDone {
  taskId: string;
  title: string;
  completedAt: string;
  priority: TaskPriority;
}

export interface ReportListStat {
  listId: string;
  name: string;
  count: number;
}

export interface ReportOverviewTotals {
  completed: number;
  wrote: number;
  carried: number;
  captured: number;
  completedDelta: number;
  wroteDelta: number;
}

export interface ReportOverview {
  type: ReportType;
  period: ReportPeriodRef;
  previousPeriod: ReportPeriodRef;
  totals: ReportOverviewTotals;
  streaks: { completedDays: number; wroteDays: number };
  heatmap: ReportHeatCell[];
  heatmapGrain: 'day' | 'month' | 'year';
  recentDone: ReportRecentDone[];
  byPriority: { 0: number; 1: number; 2: number; 3: number };
  byList: ReportListStat[];
}

export interface ReportReviewTask {
  taskId: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  completedAt: string | null;
  completionId: string | null;
  listId: string;
}

/**
 * Carried task at review time: frozen snapshot facts plus the task's live
 * state now — so a later completion reads as "still carried then, done on X".
 */
export interface ReportCarriedTask {
  taskId: string;
  title: string;
  priority: TaskPriority;
  dueAt: string | null;
  listId: string;
  /** Live state at read time. */
  status: TaskStatus;
  completedAt: string | null;
  completionId: string | null;
  deleted: boolean;
}

export interface ReportReviewInbox {
  inboxId: string;
  title: string;
  status: InboxStatus;
  capturedAt: string;
}

export interface ReviewHabitProgress {
  habitId: string;
  title: string;
  done: number;
  target: number | null;
}

export interface ReportReview {
  reportId: string;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  completed: ReportReviewTask[];
  carried: ReportCarriedTask[];
  captured: ReportReviewInbox[];
  habitProgress: ReviewHabitProgress[];
}
