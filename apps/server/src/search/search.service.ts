import type {
  InboxItem,
  ReportListItem,
  SearchHit,
  SearchInput,
  SearchResponse,
  Task,
} from '@vital/dto';
import { and, desc, eq, inArray, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  inboxItems,
  reports,
  taskTags,
  tasks,
  type InboxItemRow,
  type ReportRow,
  type TaskRow,
} from '../db/schema.js';
import { loadAssetsByItemIds, toInboxDto } from '../inbox/inbox.service.js';
import { toReportListItem } from '../reports/reports.service.js';
import { decodeSearchCursor, encodeSearchCursor } from '../utils/cursor.js';

function asStatus(value: string): Task['status'] {
  if (value === 'todo' || value === 'doing' || value === 'done' || value === 'canceled') {
    return value;
  }
  return 'todo';
}

function asPriority(value: number): Task['priority'] {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  return 3;
}

function asBucket(value: string): Task['timeBucket'] {
  if (value === 'dated' || value === 'anytime' || value === 'someday') return value;
  return 'anytime';
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function toTaskDto(row: TaskRow, tagIds: string[]): Task {
  return {
    id: row.id,
    listId: row.listId,
    parentId: row.parentId,
    title: row.title,
    notes: row.notesMd,
    status: asStatus(row.status),
    priority: asPriority(row.priority),
    dueAt: iso(row.dueAt),
    startAt: iso(row.startAt),
    remindAt: iso(row.remindAt),
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    timeBucket: asBucket(row.timeBucket),
    recurrence: row.recurrenceRrule,
    recurrenceDtstart: iso(row.recurrenceDtstart),
    completedAt: iso(row.completedAt),
    sortOrder: row.sortOrder,
    tagIds,
    deletedAt: iso(row.deletedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function escapeLike(q: string): string {
  return q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function asRank(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cursorFilter(
  rankExpr: SQL,
  updatedAt: SQLWrapper,
  idCol: SQLWrapper,
  cursor: string | undefined,
): SQL | undefined {
  if (cursor === undefined) return undefined;
  const cur = decodeSearchCursor(cursor);
  const t = new Date(cur.t);
  return or(
    sql`${rankExpr} < ${cur.rank}`,
    and(sql`${rankExpr} = ${cur.rank}`, sql`${updatedAt} < ${t}`),
    and(sql`${rankExpr} = ${cur.rank}`, sql`${updatedAt} = ${t}`, sql`${idCol} < ${cur.id}`),
  );
}

type Ranked =
  | { type: 'task'; rank: number; updatedAt: Date; id: string; row: TaskRow }
  | { type: 'inbox'; rank: number; updatedAt: Date; id: string; row: InboxItemRow }
  | { type: 'report'; rank: number; updatedAt: Date; id: string; row: ReportRow };

function cmpRanked(a: Ranked, b: Ranked): number {
  if (a.rank !== b.rank) return b.rank - a.rank;
  const ta = a.updatedAt.getTime();
  const tb = b.updatedAt.getTime();
  if (ta !== tb) return tb - ta;
  return b.id.localeCompare(a.id);
}

export async function searchTasks(userId: string, input: SearchInput): Promise<SearchResponse> {
  const types = input.types ?? ['task', 'inbox', 'report'];
  const wantTask = types.includes('task');
  const wantInbox = types.includes('inbox');
  const wantReport = types.includes('report');
  if (!wantTask && !wantInbox && !wantReport) {
    return { items: [], nextCursor: null };
  }
  const q = input.q;
  const limit = input.limit ?? 20;
  const like = `%${escapeLike(q)}%`;
  const ranked: Ranked[] = [];

  if (wantTask) {
    const match = or(
      sql`${tasks.searchTsv} @@ plainto_tsquery('simple', ${q})`,
      sql`${tasks.title} % ${q}`,
      sql`(char_length(${q}) <= 8 AND ${tasks.title} ILIKE ${like} ESCAPE '\\')`,
    );
    const rankExpr = sql<number>`round(ts_rank(${tasks.searchTsv}, plainto_tsquery('simple', ${q}))::numeric, 6)`;
    let where: SQL | undefined = and(eq(tasks.userId, userId), isNull(tasks.deletedAt), match);
    const extra = cursorFilter(rankExpr, tasks.updatedAt, tasks.id, input.cursor);
    if (extra) where = and(where, extra);
    const rows = await getDb()
      .select({ task: tasks, rank: rankExpr })
      .from(tasks)
      .where(where)
      .orderBy(sql`${rankExpr} DESC`, desc(tasks.updatedAt), desc(tasks.id))
      .limit(limit + 1);
    for (const row of rows) {
      ranked.push({
        type: 'task',
        rank: asRank(row.rank),
        updatedAt: row.task.updatedAt,
        id: row.task.id,
        row: row.task,
      });
    }
  }

  if (wantInbox) {
    const match = or(
      sql`${inboxItems.searchTsv} @@ plainto_tsquery('simple', ${q})`,
      sql`${inboxItems.title} % ${q}`,
      sql`(char_length(${q}) <= 8 AND ${inboxItems.title} ILIKE ${like} ESCAPE '\\')`,
    );
    const rankExpr = sql<number>`round(ts_rank(${inboxItems.searchTsv}, plainto_tsquery('simple', ${q}))::numeric, 6)`;
    let where: SQL | undefined = and(
      eq(inboxItems.userId, userId),
      isNull(inboxItems.deletedAt),
      match,
    );
    const extra = cursorFilter(rankExpr, inboxItems.updatedAt, inboxItems.id, input.cursor);
    if (extra) where = and(where, extra);
    const rows = await getDb()
      .select({ item: inboxItems, rank: rankExpr })
      .from(inboxItems)
      .where(where)
      .orderBy(sql`${rankExpr} DESC`, desc(inboxItems.updatedAt), desc(inboxItems.id))
      .limit(limit + 1);
    for (const row of rows) {
      ranked.push({
        type: 'inbox',
        rank: asRank(row.rank),
        updatedAt: row.item.updatedAt,
        id: row.item.id,
        row: row.item,
      });
    }
  }

  if (wantReport) {
    const match = or(
      sql`${reports.searchTsv} @@ plainto_tsquery('simple', ${q})`,
      sql`${reports.title} % ${q}`,
      sql`(char_length(${q}) <= 8 AND ${reports.title} ILIKE ${like} ESCAPE '\\')`,
    );
    const rankExpr = sql<number>`round(ts_rank(${reports.searchTsv}, plainto_tsquery('simple', ${q}))::numeric, 6)`;
    let where: SQL | undefined = and(eq(reports.userId, userId), match);
    const extra = cursorFilter(rankExpr, reports.updatedAt, reports.id, input.cursor);
    if (extra) where = and(where, extra);
    const rows = await getDb()
      .select({ report: reports, rank: rankExpr })
      .from(reports)
      .where(where)
      .orderBy(sql`${rankExpr} DESC`, desc(reports.updatedAt), desc(reports.id))
      .limit(limit + 1);
    for (const row of rows) {
      ranked.push({
        type: 'report',
        rank: asRank(row.rank),
        updatedAt: row.report.updatedAt,
        id: row.report.id,
        row: row.report,
      });
    }
  }

  ranked.sort(cmpRanked);
  const page = ranked.slice(0, limit);
  const taskIds = page.filter((r) => r.type === 'task').map((r) => r.id);
  const inboxIds = page.filter((r) => r.type === 'inbox').map((r) => r.id);
  const tagMap = new Map<string, string[]>();
  for (const id of taskIds) tagMap.set(id, []);
  if (taskIds.length > 0) {
    const links = await getDb().select().from(taskTags).where(inArray(taskTags.taskId, taskIds));
    for (const link of links) {
      const list = tagMap.get(link.taskId);
      if (list) list.push(link.tagId);
    }
  }
  const assetMap = await loadAssetsByItemIds(inboxIds);

  const items: SearchHit[] = page.map((row) => {
    if (row.type === 'task') {
      return { type: 'task' as const, task: toTaskDto(row.row, tagMap.get(row.id) ?? []) };
    }
    if (row.type === 'report') {
      const report: ReportListItem = toReportListItem(row.row);
      return { type: 'report' as const, report };
    }
    const inbox: InboxItem = toInboxDto(row.row, assetMap.get(row.id) ?? []);
    return { type: 'inbox' as const, inbox };
  });

  let nextCursor: string | null = null;
  if (ranked.length > limit) {
    const last = page[page.length - 1];
    if (last) {
      nextCursor = encodeSearchCursor(last.rank, last.updatedAt.toISOString(), last.id);
    }
  }
  return { items, nextCursor };
}
