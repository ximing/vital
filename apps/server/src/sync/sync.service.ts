import type {
  InboxItem,
  SyncChanges,
  SyncChangesQuery,
  SyncCursor,
  SyncHead,
  SyncKeyset,
  Task,
} from '@vital/dto';
import {
  encodeSyncCursor,
  isoToSyncCursor,
  overlapSyncCursor,
  parseSyncSince,
} from '@vital/dto';
import { and, asc, eq, gt, gte, inArray, max, or, sql, type Column, type SQL } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { inboxItems, reports, tasks, taskTags } from '../db/schema.js';
import { AppError } from '../errors.js';
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

/**
 * ISO `since` keeps exclusive `updated_at > ts` so old clients that page on
 * `latestUpdatedAt` cannot loop. Opaque cursors use keyset comparison.
 * Empty `id` means "start of this timestamp" (`updated_at >= ts`).
 */
function afterKeyset(
  updatedAt: Column,
  id: Column,
  key: SyncKeyset,
  exclusiveTimestamp: boolean,
): SQL {
  const ts = new Date(key.ts);
  if (exclusiveTimestamp) return gt(updatedAt, ts);
  if (key.id === '') return gte(updatedAt, ts);
  return or(gt(updatedAt, ts), and(eq(updatedAt, ts), sql`${id} > ${key.id}`)) as SQL;
}

function keysetOf(row: { updatedAt: Date; id: string } | undefined, fallback: SyncKeyset): SyncKeyset {
  if (!row) return fallback;
  return { ts: row.updatedAt.toISOString(), id: row.id };
}

export async function getSyncChanges(
  userId: string,
  query: SyncChangesQuery,
): Promise<SyncChanges> {
  const serverTime = new Date();
  const parsed = parseSyncSince(query.since);
  if (parsed === null) throw AppError.of(400, 'VALIDATION_ERROR');
  const exclusiveTimestamp = parsed.kind === 'iso';
  const incoming: SyncCursor =
    parsed.kind === 'iso' ? isoToSyncCursor(parsed.at) : parsed.cursor;

  const limit = query.limit;
  const fetchLimit = limit + 1;
  const db = getDb();

  const [taskRows, inboxRows, reportRows] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          afterKeyset(tasks.updatedAt, tasks.id, incoming.tasks, exclusiveTimestamp),
        ),
      )
      .orderBy(asc(tasks.updatedAt), asc(tasks.id))
      .limit(fetchLimit),
    db
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, userId),
          afterKeyset(inboxItems.updatedAt, inboxItems.id, incoming.inbox, exclusiveTimestamp),
        ),
      )
      .orderBy(asc(inboxItems.updatedAt), asc(inboxItems.id))
      .limit(fetchLimit),
    db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.userId, userId),
          afterKeyset(reports.updatedAt, reports.id, incoming.reports, exclusiveTimestamp),
        ),
      )
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

  const nextCursor = truncated
    ? {
        tasks: keysetOf(taskPage[taskPage.length - 1], incoming.tasks),
        inbox: keysetOf(inboxPage[inboxPage.length - 1], incoming.inbox),
        reports: keysetOf(reportPage[reportPage.length - 1], incoming.reports),
      }
    : overlapSyncCursor(serverTime);

  return {
    serverTime: serverTime.toISOString(),
    head: await getSyncHead(userId),
    tasks: mappedTasks,
    inbox: mappedInbox,
    reports: reportPage.map(toReportListItem),
    truncated,
    nextSince: encodeSyncCursor(nextCursor),
  };
}
