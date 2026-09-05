import { randomUUID } from 'node:crypto';
import {
  ensureFillHeadings,
  extractTokens,
  insertTokensIdempotent,
  type EntityToken,
} from '@vital/markdown';
import {
  fillHeadingsFor,
  renderReportTemplate,
  reportTypeSchema,
  type FillReportInput,
  type GetReportQuery,
  type InboxStatus,
  type ListReportsQuery,
  type PatchReportInput,
  type Report,
  type ReportCollection,
  type ReportEmbeds,
  type ReportEmbedsResponse,
  type ReportInboxEmbed,
  type ReportListItem,
  type ReportSnapshot,
  type ReportTaskEmbed,
  type ReportType,
  type TaskStatus,
  type UserProfile,
} from '@vital/dto';
import { and, desc, eq, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import {
  entityLinks,
  inboxItems,
  reports,
  tasks,
  type ReportRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import { currentPeriod, localDate, periodInstants, previousPeriodStart } from './period.js';

function asType(value: string): ReportType {
  const parsed = reportTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'daily';
}

function asTaskStatus(value: string): TaskStatus {
  if (value === 'todo' || value === 'doing' || value === 'done' || value === 'canceled') {
    return value;
  }
  return 'todo';
}

function asInboxStatus(value: string): InboxStatus {
  if (value === 'unread' || value === 'later' || value === 'archived' || value === 'converted') {
    return value;
  }
  return 'unread';
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isReportSnapshot(value: unknown): value is ReportSnapshot {
  if (!isRecord(value)) return false;
  if (typeof value.title !== 'string' || typeof value.bodyMd !== 'string') return false;
  if (typeof value.revision !== 'number') return false;
  if (!isRecord(value.embeds) || !isRecord(value.embeds.tasks) || !isRecord(value.embeds.inbox)) {
    return false;
  }
  return true;
}

export function toReportListItem(row: ReportRow): ReportListItem {
  return {
    id: row.id,
    type: asType(row.type),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    title: row.title,
    revision: row.revision,
    snapshotAt: iso(row.snapshotAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOwnedReportOr404(userId: string, id: string): Promise<ReportRow> {
  const [row] = await getDb().select().from(reports).where(eq(reports.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'REPORT_NOT_FOUND');
  return row;
}

export async function hydrateEmbeds(userId: string, bodyMd: string): Promise<ReportEmbeds> {
  const tokens = extractTokens(bodyMd);
  const taskIds = [...new Set(tokens.filter((t) => t.kind === 'task').map((t) => t.id))];
  const inboxIds = [...new Set(tokens.filter((t) => t.kind === 'inbox').map((t) => t.id))];
  const taskMap: Record<string, ReportTaskEmbed> = {};
  const inboxMap: Record<string, ReportInboxEmbed> = {};
  if (taskIds.length > 0) {
    const rows = await getDb()
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, taskIds)));
    for (const row of rows) {
      taskMap[row.id] = {
        id: row.id,
        title: row.title,
        status: asTaskStatus(row.status),
        deletedAt: iso(row.deletedAt),
      };
    }
  }
  if (inboxIds.length > 0) {
    const rows = await getDb()
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.userId, userId), inArray(inboxItems.id, inboxIds)));
    for (const row of rows) {
      inboxMap[row.id] = {
        id: row.id,
        title: row.title,
        status: asInboxStatus(row.status),
        deletedAt: iso(row.deletedAt),
      };
    }
  }
  return { tasks: taskMap, inbox: inboxMap };
}

function toReport(row: ReportRow, embeds: ReportEmbeds): Report {
  return { ...toReportListItem(row), bodyMd: row.bodyMd, embeds };
}

async function liveReport(row: ReportRow): Promise<Report> {
  return toReport(row, await hydrateEmbeds(row.userId, row.bodyMd));
}

function snapshotReport(row: ReportRow, snap: ReportSnapshot): Report {
  return {
    ...toReportListItem(row),
    title: snap.title,
    bodyMd: snap.bodyMd,
    revision: snap.revision,
    embeds: snap.embeds,
  };
}

async function freezeIfNeeded(row: ReportRow): Promise<void> {
  if (row.snapshotAt !== null && row.snapshotJson) return;
  const embeds = await hydrateEmbeds(row.userId, row.bodyMd);
  const snapshot: ReportSnapshot = {
    title: row.title,
    bodyMd: row.bodyMd,
    revision: row.revision,
    embeds,
  };
  await getDb()
    .update(reports)
    .set({ snapshotJson: snapshot, snapshotAt: new Date(), updatedAt: new Date() })
    .where(and(eq(reports.id, row.id), sql`${reports.snapshotAt} IS NULL`));
}

async function syncEmbedLinks(userId: string, reportId: string, bodyMd: string): Promise<void> {
  const tokens = extractTokens(bodyMd);
  const seen = new Set<string>();
  const values: {
    id: string;
    userId: string;
    fromType: 'report';
    fromId: string;
    toType: 'task' | 'inbox';
    toId: string;
    role: 'embeds';
  }[] = [];
  for (const token of tokens) {
    const key = `${token.kind}:${token.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push({
      id: randomUUID(),
      userId,
      fromType: 'report',
      fromId: reportId,
      toType: token.kind,
      toId: token.id,
      role: 'embeds',
    });
  }
  await getDb()
    .delete(entityLinks)
    .where(
      and(
        eq(entityLinks.fromType, 'report'),
        eq(entityLinks.fromId, reportId),
        eq(entityLinks.role, 'embeds'),
      ),
    );
  if (values.length > 0) {
    await getDb().insert(entityLinks).values(values).onConflictDoNothing();
  }
}

export async function listReports(userId: string, query: ListReportsQuery): Promise<ReportCollection> {
  const limit = query.limit;
  const filters: SQL[] = [eq(reports.userId, userId)];
  if (query.type !== undefined) filters.push(eq(reports.type, query.type));
  let where: SQL = and(...filters) as SQL;
  if (query.cursor !== undefined) {
    const cur = decodeCursor(query.cursor);
    where = and(
      where,
      or(
        lt(reports.periodStart, cur.t),
        and(eq(reports.periodStart, cur.t), sql`${reports.id} < ${cur.id}`),
      ),
    ) as SQL;
  }
  const rows = await getDb()
    .select()
    .from(reports)
    .where(where)
    .orderBy(desc(reports.periodStart), desc(reports.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toReportListItem),
    nextCursor: rows.length > limit && last ? encodeCursor(last.periodStart, last.id) : null,
  };
}

export async function getCurrentReport(user: UserProfile, type: ReportType): Promise<Report> {
  const period = currentPeriod(type, user.timezone, user.weekStartsOn);
  const [existing] = await getDb()
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.userId, user.id),
        eq(reports.type, type),
        eq(reports.periodStart, period.start),
      ),
    )
    .limit(1);
  if (existing) return liveReport(existing);

  const prevStart = previousPeriodStart(type, period.start, user.timezone);
  const [previous] = await getDb()
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.userId, user.id),
        eq(reports.type, type),
        eq(reports.periodStart, prevStart),
      ),
    )
    .limit(1);
  if (previous) await freezeIfNeeded(previous);

  const rendered = renderReportTemplate(type, period.label);
  const id = randomUUID();
  const now = new Date();
  try {
    const [created] = await getDb()
      .insert(reports)
      .values({
        id,
        userId: user.id,
        type,
        periodStart: period.start,
        periodEnd: period.end,
        title: rendered.title,
        bodyMd: rendered.bodyMd,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw AppError.of(500, 'INTERNAL_ERROR');
    return await liveReport(created);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [again] = await getDb()
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.userId, user.id),
          eq(reports.type, type),
          eq(reports.periodStart, period.start),
        ),
      )
      .limit(1);
    if (!again) throw AppError.of(500, 'INTERNAL_ERROR');
    return await liveReport(again);
  }
}

export async function getReport(
  userId: string,
  id: string,
  query: GetReportQuery,
): Promise<Report> {
  const row = await getOwnedReportOr404(userId, id);
  if (query.asOf === 'snapshot' && row.snapshotJson && isReportSnapshot(row.snapshotJson)) {
    return snapshotReport(row, row.snapshotJson);
  }
  return liveReport(row);
}

export async function getReportEmbeds(userId: string, id: string): Promise<ReportEmbedsResponse> {
  const row = await getOwnedReportOr404(userId, id);
  return { revision: row.revision, embeds: await hydrateEmbeds(userId, row.bodyMd) };
}

async function bumpOrConflict(
  userId: string,
  id: string,
  revision: number,
  patch: { title?: string; bodyMd?: string },
): Promise<ReportRow> {
  const now = new Date();
  const set: { revision: number; updatedAt: Date; title?: string; bodyMd?: string } = {
    revision: revision + 1,
    updatedAt: now,
  };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.bodyMd !== undefined) set.bodyMd = patch.bodyMd;
  const [updated] = await getDb()
    .update(reports)
    .set(set)
    .where(and(eq(reports.id, id), eq(reports.userId, userId), eq(reports.revision, revision)))
    .returning();
  if (!updated) {
    await getOwnedReportOr404(userId, id);
    throw AppError.of(409, 'REPORT_REVISION_CONFLICT');
  }
  return updated;
}

export async function patchReport(
  userId: string,
  id: string,
  input: PatchReportInput,
): Promise<Report> {
  await getOwnedReportOr404(userId, id);
  const patch: { title?: string; bodyMd?: string } = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.bodyMd !== undefined) patch.bodyMd = input.bodyMd;
  const updated = await bumpOrConflict(userId, id, input.revision, patch);
  if (input.bodyMd !== undefined) await syncEmbedLinks(userId, id, updated.bodyMd);
  return liveReport(updated);
}

function tokenOf(kind: EntityToken['kind'], id: string): EntityToken {
  return { kind, id, start: 0, end: 0 };
}

export async function fillReport(
  user: UserProfile,
  id: string,
  input: FillReportInput,
): Promise<Report> {
  const row = await getOwnedReportOr404(user.id, id);
  if (row.revision !== input.revision) throw AppError.of(409, 'REPORT_REVISION_CONFLICT');
  const type = asType(row.type);
  const headings = fillHeadingsFor(type);
  const tz = user.timezone;
  const bounds = periodInstants(row.periodStart, row.periodEnd, tz);

  const openTasks = await getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['todo', 'doing']),
      ),
    );
  const fillTasks = openTasks.filter((task) => {
    const anchor = task.dueAt ?? task.startAt;
    const inPeriod =
      anchor !== null &&
      localDate(anchor, tz) >= row.periodStart &&
      localDate(anchor, tz) < row.periodEnd;
    const overdue = task.dueAt !== null && task.dueAt.getTime() < bounds.end.getTime();
    return inPeriod || overdue;
  });
  fillTasks.sort((a, b) => {
    const da = a.dueAt?.getTime() ?? a.startAt?.getTime() ?? 0;
    const db = b.dueAt?.getTime() ?? b.startAt?.getTime() ?? 0;
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });

  const inboxRows = await getDb()
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, user.id),
        isNull(inboxItems.deletedAt),
        ne(inboxItems.status, 'archived'),
        sql`${inboxItems.capturedAt} >= ${bounds.start}`,
        sql`${inboxItems.capturedAt} < ${bounds.end}`,
      ),
    )
    .orderBy(inboxItems.capturedAt, inboxItems.id);

  const existing = new Set(extractTokens(row.bodyMd).map((t) => `${t.kind}:${t.id}`));
  const tokens: EntityToken[] = [];
  for (const task of fillTasks) {
    const key = `task:${task.id}`;
    if (existing.has(key)) continue;
    existing.add(key);
    tokens.push(tokenOf('task', task.id));
  }
  for (const item of inboxRows) {
    const key = `inbox:${item.id}`;
    if (existing.has(key)) continue;
    existing.add(key);
    tokens.push(tokenOf('inbox', item.id));
  }

  let bodyMd = ensureFillHeadings(row.bodyMd, headings);
  bodyMd = insertTokensIdempotent(bodyMd, tokens, headings);
  const updated = await bumpOrConflict(user.id, id, input.revision, { bodyMd });
  await syncEmbedLinks(user.id, id, updated.bodyMd);
  return liveReport(updated);
}
