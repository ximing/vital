import { z } from 'zod';
import type { InboxItem } from './inbox.js';
import type { ReportListItem } from './reports.js';
import type { Task } from './tasks.js';

export interface SyncHead {
  tasksMaxUpdatedAt: string | null;
  inboxMaxUpdatedAt: string | null;
  reportsMaxUpdatedAt: string | null;
  revision: number;
}

/** Incremental pull. Tasks/inbox include `deletedAt` tombstones. Reports omit `bodyMd`. */
export interface SyncChanges {
  serverTime: string;
  head: SyncHead;
  tasks: Task[];
  inbox: InboxItem[];
  reports: ReportListItem[];
  truncated: boolean;
}

export const SYNC_EVENTS_PATH = '/api/v1/sync/events';

export const syncChangesQuerySchema = z.object({
  since: z
    .string()
    .min(1)
    .refine((value) => Number.isFinite(Date.parse(value)), 'iso datetime'),
  limit: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? 200 : Number(value)))
    .pipe(z.number().int().min(1).max(500)),
});
export type SyncChangesQuery = z.infer<typeof syncChangesQuerySchema>;

export type SyncHelloMessage = { type: 'hello'; token: string };
export type SyncReadyMessage = { type: 'ready' };
export type SyncInvalidateMessage = { type: 'invalidate'; at: string };
