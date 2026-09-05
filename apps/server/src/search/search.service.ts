import type { SearchInput, SearchResponse, Task } from '@vital/dto';
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tasks, taskTags, type TaskRow } from '../db/schema.js';
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

export async function searchTasks(userId: string, input: SearchInput): Promise<SearchResponse> {
  const types = input.types ?? ['task'];
  if (!types.includes('task')) {
    return { items: [], nextCursor: null };
  }
  const q = input.q;
  const limit = input.limit ?? 20;
  const like = `%${escapeLike(q)}%`;
  const match = or(
    sql`${tasks.searchTsv} @@ plainto_tsquery('simple', ${q})`,
    sql`${tasks.title} % ${q}`,
    sql`(char_length(${q}) <= 8 AND ${tasks.title} ILIKE ${like} ESCAPE '\\')`,
  );
  // Same expression in SELECT / ORDER BY / keyset so pages follow rank, not recency.
  const rankExpr = sql<number>`round(ts_rank(${tasks.searchTsv}, plainto_tsquery('simple', ${q}))::numeric, 6)`;
  let where: SQL | undefined = and(eq(tasks.userId, userId), isNull(tasks.deletedAt), match);
  if (input.cursor !== undefined) {
    const cur = decodeSearchCursor(input.cursor);
    const t = new Date(cur.t);
    where = and(
      where,
      or(
        sql`${rankExpr} < ${cur.rank}`,
        and(sql`${rankExpr} = ${cur.rank}`, sql`${tasks.updatedAt} < ${t}`),
        and(sql`${rankExpr} = ${cur.rank}`, eq(tasks.updatedAt, t), sql`${tasks.id} < ${cur.id}`),
      ),
    );
  }

  const rows = await getDb()
    .select({
      task: tasks,
      rank: rankExpr,
    })
    .from(tasks)
    .where(where)
    .orderBy(sql`${rankExpr} DESC`, desc(tasks.updatedAt), desc(tasks.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const tagMap = new Map<string, string[]>();
  for (const row of page) tagMap.set(row.task.id, []);
  if (page.length > 0) {
    const links = await getDb()
      .select()
      .from(taskTags)
      .where(inArray(taskTags.taskId, page.map((r) => r.task.id)));
    for (const link of links) {
      const list = tagMap.get(link.taskId);
      if (list) list.push(link.tagId);
    }
  }
  const items = page.map((row) => ({
    type: 'task' as const,
    task: toTaskDto(row.task, tagMap.get(row.task.id) ?? []),
  }));
  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = page[page.length - 1];
    if (last) {
      nextCursor = encodeSearchCursor(asRank(last.rank), last.task.updatedAt.toISOString(), last.task.id);
    }
  }
  return { items, nextCursor };
}
