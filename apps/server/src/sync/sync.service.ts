import type { InboxItem, SyncChanges, SyncChangesQuery, SyncHead, Task } from '@vital/dto';
import { and, asc, eq, gt, inArray, max } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { inboxItems, reports, tasks, taskTags } from '../db/schema.js';
import { loadAssetsByItemIds, tagIdsByInbox, toInboxDto } from '../inbox/inbox.service.js';
import { toReportListItem } from '../reports/reports.service.js';
import { toTaskDto } from '../tasks/task-dto.js';

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

async function tagIdsByTask(taskIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const id of taskIds) map.set(id, []);
  if (taskIds.length === 0) return map;
  const rows = await getDb().select().from(taskTags).where(inArray(taskTags.taskId, taskIds));
  for (const row of rows) {
    const current = map.get(row.taskId);
    if (current) current.push(row.tagId);
    else map.set(row.taskId, [row.tagId]);
  }
  return map;
}

export async function getSyncChanges(
  userId: string,
  query: SyncChangesQuery,
): Promise<SyncChanges> {
  const since = new Date(query.since);
  const limit = query.limit;
  const fetchLimit = limit + 1;
  const db = getDb();

  const [taskRows, inboxRows, reportRows] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), gt(tasks.updatedAt, since)))
      .orderBy(asc(tasks.updatedAt), asc(tasks.id))
      .limit(fetchLimit),
    db
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.userId, userId), gt(inboxItems.updatedAt, since)))
      .orderBy(asc(inboxItems.updatedAt), asc(inboxItems.id))
      .limit(fetchLimit),
    db
      .select()
      .from(reports)
      .where(and(eq(reports.userId, userId), gt(reports.updatedAt, since)))
      .orderBy(asc(reports.updatedAt), asc(reports.id))
      .limit(fetchLimit),
  ]);

  const truncated =
    taskRows.length > limit || inboxRows.length > limit || reportRows.length > limit;
  const taskPage = taskRows.slice(0, limit);
  const inboxPage = inboxRows.slice(0, limit);
  const reportPage = reportRows.slice(0, limit);

  const inboxIds = inboxPage.map((row) => row.id);
  const [tags, inboxTags, assets] = await Promise.all([
    tagIdsByTask(taskPage.map((row) => row.id)),
    tagIdsByInbox(inboxIds),
    loadAssetsByItemIds(inboxIds),
  ]);

  const mappedTasks: Task[] = taskPage.map((row) => toTaskDto(row, tags.get(row.id) ?? []));
  const mappedInbox: InboxItem[] = inboxPage.map((row) =>
    toInboxDto(row, assets.get(row.id) ?? [], inboxTags.get(row.id) ?? []),
  );

  return {
    serverTime: new Date().toISOString(),
    head: await getSyncHead(userId),
    tasks: mappedTasks,
    inbox: mappedInbox,
    reports: reportPage.map(toReportListItem),
    truncated,
  };
}
