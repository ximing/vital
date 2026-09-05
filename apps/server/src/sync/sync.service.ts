import type { SyncHead } from '@vital/dto';
import { eq, max } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { inboxItems, reports, tasks } from '../db/schema.js';

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function epoch(d: Date | null | undefined): number {
  return d ? d.getTime() : 0;
}

export async function getSyncHead(userId: string): Promise<SyncHead> {
  const db = getDb();
  const [taskRow] = await db
    .select({ t: max(tasks.updatedAt) })
    .from(tasks)
    .where(eq(tasks.userId, userId));
  const [inboxRow] = await db
    .select({ t: max(inboxItems.updatedAt) })
    .from(inboxItems)
    .where(eq(inboxItems.userId, userId));
  const [reportRow] = await db
    .select({ t: max(reports.updatedAt), rev: max(reports.revision) })
    .from(reports)
    .where(eq(reports.userId, userId));

  const tasksMaxUpdatedAt = iso(taskRow?.t);
  const inboxMaxUpdatedAt = iso(inboxRow?.t);
  const reportsMaxUpdatedAt = iso(reportRow?.t);
  // Any task/inbox write must move this even when reports.updated_at is unchanged.
  const revision = Math.max(
    epoch(taskRow?.t),
    epoch(inboxRow?.t),
    epoch(reportRow?.t),
    reportRow?.rev ?? 0,
  );
  return { tasksMaxUpdatedAt, inboxMaxUpdatedAt, reportsMaxUpdatedAt, revision };
}
