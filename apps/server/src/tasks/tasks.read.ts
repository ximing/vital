import type {
  CalendarQuery,
  CalendarResponse,
  ListTasksQuery,
  Task,
  TaskCollection,
  TaskCounts,
} from '@vital/dto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getUserEntity } from '../auth/auth.service.js';
import { getDb } from '../db/index.js';
import { taskCompletions, tasks, type TaskRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import {
  chinaCalendarLookupFromWindow,
  loadChinaCalendarWindow,
} from '../holidays/china-calendar.js';
import { getInboxList, listIdAndDescendants } from '../lists/lists.service.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import { expandFixedTask, expandTask } from './recurrence.js';
import { asPriority, asRecurrenceKind, toTaskDto } from './task-dto.js';
import { dtoOf, tagIdsByTask, toRecurrence } from './tasks.shared.js';

export async function getOwnedTaskOr404(
  userId: string,
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<TaskRow> {
  const [row] = await getDb().select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'TASK_NOT_FOUND');
  if (!opts.includeDeleted && row.deletedAt) throw AppError.of(404, 'TASK_NOT_FOUND');
  return row;
}

/**
 * Local calendar-day bounds as UTC instants. Local midnight overflows into the
 * previous/next UTC day (e.g. 00:00 UTC+8 = 16:00Z prior day); comparing the
 * bare timestamptz column to these bounds keeps due_at/start_at indexable.
 */
function localDayUtcRange(
  tz: string,
  now: Date,
  fromDayOffset: number,
  toDayOffsetExclusive: number,
): { start: Date; end: Date } {
  const origin = DateTime.fromJSDate(now).setZone(tz).startOf('day');
  return {
    start: origin.plus({ days: fromDayOffset }).toJSDate(),
    end: origin.plus({ days: toDayOffsetExclusive }).toJSDate(),
  };
}

function openCond(userId: string): SQL {
  return and(
    eq(tasks.userId, userId),
    isNull(tasks.deletedAt),
    inArray(tasks.status, ['todo', 'doing']),
  ) as SQL;
}

async function smartFilter(userId: string, listId: string, tz: string, now = new Date()): Promise<SQL> {
  switch (listId) {
    case 'smart:inbox': {
      const inbox = await getInboxList(userId);
      return and(openCond(userId), eq(tasks.listId, inbox.id)) as SQL;
    }
    case 'smart:today': {
      const { start: todayStart, end: tomorrowStart } = localDayUtcRange(tz, now, 0, 1);
      return and(
        openCond(userId),
        or(
          and(isNotNull(tasks.dueAt), lt(tasks.dueAt, tomorrowStart)),
          and(isNotNull(tasks.startAt), gte(tasks.startAt, todayStart), lt(tasks.startAt, tomorrowStart)),
        ),
      ) as SQL;
    }
    case 'smart:upcoming': {
      const { start, end } = localDayUtcRange(tz, now, 0, 8);
      return and(
        openCond(userId),
        or(
          and(isNotNull(tasks.dueAt), gte(tasks.dueAt, start), lt(tasks.dueAt, end)),
          and(isNotNull(tasks.startAt), gte(tasks.startAt, start), lt(tasks.startAt, end)),
        ),
      ) as SQL;
    }
    case 'smart:someday':
      return and(openCond(userId), isNull(tasks.dueAt), isNull(tasks.startAt)) as SQL;
    case 'smart:done':
      return and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        eq(tasks.status, 'done'),
        isNotNull(tasks.completedAt),
        sql`${tasks.completedAt} >= now() - interval '30 days'`,
      ) as SQL;
    default: {
      const ids = await listIdAndDescendants(userId, listId);
      return and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        inArray(tasks.listId, ids),
      ) as SQL;
    }
  }
}

export async function listTasks(userId: string, query: ListTasksQuery): Promise<TaskCollection> {
  const user = await getUserEntity(userId);
  const where = await smartFilter(userId, query.listId, user.timezone);
  const limit = query.limit;
  const order =
    query.listId === 'smart:done'
      ? [desc(tasks.completedAt), desc(tasks.id)]
      : [asc(tasks.sortOrder), asc(tasks.id)];

  let cond: SQL = where;
  if (query.cursor !== undefined) {
    const cur = decodeCursor(query.cursor);
    if (query.listId === 'smart:done') {
      const t = new Date(cur.t);
      cond = and(
        where,
        or(lt(tasks.completedAt, t), and(eq(tasks.completedAt, t), lt(tasks.id, cur.id))),
      ) as SQL;
    } else {
      const sort = Number(cur.t);
      cond = and(
        where,
        or(
          sql`${tasks.sortOrder} > ${sort}`,
          and(eq(tasks.sortOrder, sort), sql`${tasks.id} > ${cur.id}`),
        ),
      ) as SQL;
    }
  }

  const rows = await getDb()
    .select()
    .from(tasks)
    .where(cond)
    .orderBy(...order)
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const tags = await tagIdsByTask(page.map((r) => r.id));
  const items = page.map((r) => toTaskDto(r, tags.get(r.id) ?? []));
  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = page[page.length - 1];
    if (last) {
      const t =
        query.listId === 'smart:done'
          ? (last.completedAt ?? last.createdAt).toISOString()
          : String(last.sortOrder);
      nextCursor = encodeCursor(t, last.id);
    }
  }
  return { items, nextCursor };
}

export async function getTask(userId: string, id: string): Promise<Task> {
  return dtoOf(await getOwnedTaskOr404(userId, id));
}

const COUNTED_SMART_IDS = [
  'smart:inbox',
  'smart:today',
  'smart:upcoming',
  'smart:someday',
] as const;

export async function taskCounts(userId: string): Promise<TaskCounts> {
  const user = await getUserEntity(userId);
  const counts: Record<string, number> = {};
  const perList = await getDb()
    .select({ listId: tasks.listId, n: count() })
    .from(tasks)
    .where(openCond(userId))
    .groupBy(tasks.listId);
  for (const row of perList) counts[row.listId] = row.n;
  for (const id of COUNTED_SMART_IDS) {
    const where = await smartFilter(userId, id, user.timezone);
    const [row] = await getDb().select({ n: count() }).from(tasks).where(where);
    counts[id] = row?.n ?? 0;
  }
  return { counts };
}

export async function calendar(userId: string, query: CalendarQuery): Promise<CalendarResponse> {
  const from = new Date(query.from);
  const to = new Date(query.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (to.getTime() - from.getTime() > 62 * 24 * 60 * 60 * 1000) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const CALENDAR_TASK_LIMIT = 2000;
  const completionPadMs = 2 * 24 * 60 * 60 * 1000;
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        or(
          isNotNull(tasks.recurrenceRrule),
          isNotNull(tasks.recurrenceKind),
          and(isNotNull(tasks.dueAt), gte(tasks.dueAt, from), lte(tasks.dueAt, to)),
          and(isNotNull(tasks.startAt), gte(tasks.startAt, from), lte(tasks.startAt, to)),
        ),
      ),
    )
    .orderBy(asc(tasks.id))
    .limit(CALENDAR_TASK_LIMIT);
  const ids = rows.map((r) => r.id);
  const completions =
    ids.length === 0
      ? []
      : await getDb()
          .select()
          .from(taskCompletions)
          .where(
            and(
              inArray(taskCompletions.taskId, ids),
              gte(taskCompletions.occurrenceAt, new Date(from.getTime() - completionPadMs)),
              lte(taskCompletions.occurrenceAt, new Date(to.getTime() + completionPadMs)),
            ),
          );
  const byTask = new Map<string, { occurrenceAt: Date }[]>();
  for (const c of completions) {
    const list = byTask.get(c.taskId) ?? [];
    list.push({ occurrenceAt: c.occurrenceAt });
    byTask.set(c.taskId, list);
  }
  const needsChina = rows.some(
    (row) => row.recurrenceKind === 'holidays' || row.recurrenceKind === 'legal_workdays',
  );
  const holidayLookup = needsChina
    ? chinaCalendarLookupFromWindow(
        await loadChinaCalendarWindow(
          DateTime.fromJSDate(from).minus({ days: 2 }).toISODate() ?? '',
          DateTime.fromJSDate(from).plus({ days: 402 }).toISODate() ?? '',
        ),
      )
    : undefined;
  const groups = await Promise.all(
    rows.map(async (row) => {
      const recurrenceKind = asRecurrenceKind(row.recurrenceKind);
      const expanded = recurrenceKind
        ? await expandFixedTask(
            { ...toRecurrence(row), recurrenceKind },
            byTask.get(row.id) ?? [],
            from,
            to,
            holidayLookup,
          )
        : expandTask(toRecurrence(row), byTask.get(row.id) ?? [], from, to);
      return expanded.map((inst) => ({
        taskId: inst.taskId,
        listId: inst.listId,
        title: inst.title,
        occurrenceAt: inst.occurrenceAt.toISOString(),
        isAllDay: inst.isAllDay,
        status: inst.status,
        priority: asPriority(inst.priority),
        pinned: inst.pinned,
      }));
    }),
  );
  const instances = groups.flat();
  instances.sort((a, b) => a.occurrenceAt.localeCompare(b.occurrenceAt));
  return { instances };
}
