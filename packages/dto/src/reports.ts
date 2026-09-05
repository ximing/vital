import { z } from 'zod';
import type { InboxStatus } from './inbox.js';
import { uuidSchema } from './lists.js';
import { reportTypeSchema, type ReportType } from './reportTemplates.js';
import type { TaskStatus } from './tasks.js';

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

export interface ReportSnapshot {
  title: string;
  bodyMd: string;
  revision: number;
  embeds: ReportEmbeds;
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
