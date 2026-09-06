import {
  hasWrote,
  type InboxStatus,
  type ReportHeatCell,
  type ReportListStat,
  type ReportOverview,
  type ReportRecentDone,
  type ReportReview,
  type ReportReviewInbox,
  type ReportReviewTask,
  type ReportType,
  type TaskPriority,
  type TaskStatus,
  type UserProfile,
} from '@vital/dto';
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getDb } from '../db/index.js';
import { inboxItems, lists, reports, taskCompletions, tasks } from '../db/schema.js';
import { AppError } from '../errors.js';
import { currentPeriod, localDate, periodInstants, previousPeriodStart } from './period.js';
import { getOwnedReportOr404 } from './reports.service.js';

function asPriority(value: number): TaskPriority {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  return 3;
}

function asStatus(value: string): TaskStatus {
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

function iso(d: Date): string {
  return d.toISOString();
}

function ymdAdd(ymd: string, days: number): string {
  return DateTime.fromISO(ymd, { zone: 'utc' }).plus({ days }).toISODate() ?? ymd;
}

function parseAnchor(user: UserProfile, at?: string): DateTime {
  const zoneNow = DateTime.now().setZone(user.timezone);
  const anchor = at
    ? DateTime.fromISO(at, { zone: user.timezone }).startOf('day')
    : zoneNow.startOf('day');
  if (!anchor.isValid) throw AppError.of(400, 'VALIDATION_ERROR');
  if (anchor > zoneNow.startOf('day')) throw AppError.of(400, 'VALIDATION_ERROR');
  return anchor;
}

function heatmapRange(
  type: ReportType,
  periodStart: string,
  timezone: string,
): { start: string; end: string; grain: 'day' | 'month' | 'year' } {
  const start = DateTime.fromISO(periodStart, { zone: timezone }).startOf('day');
  if (type === 'monthly') {
    const year = start.startOf('year');
    return {
      start: year.toISODate() ?? periodStart,
      end: year.plus({ years: 1 }).toISODate() ?? periodStart,
      grain: 'month',
    };
  }
  if (type === 'yearly') {
    const from = start.startOf('year').minus({ years: 5 });
    return {
      start: from.toISODate() ?? periodStart,
      end: start.startOf('year').plus({ years: 1 }).toISODate() ?? periodStart,
      grain: 'year',
    };
  }
  const month = start.startOf('month');
  return {
    start: month.toISODate() ?? periodStart,
    end: month.plus({ months: 1 }).toISODate() ?? periodStart,
    grain: 'day',
  };
}

function cellKey(grain: 'day' | 'month' | 'year', ymd: string): string {
  if (grain === 'day') return ymd;
  if (grain === 'month') return `${ymd.slice(0, 7)}-01`;
  return `${ymd.slice(0, 4)}-01-01`;
}

function enumerateCells(
  grain: 'day' | 'month' | 'year',
  start: string,
  end: string,
): string[] {
  const out: string[] = [];
  let cursor = DateTime.fromISO(start, { zone: 'utc' }).startOf('day');
  const stop = DateTime.fromISO(end, { zone: 'utc' }).startOf('day');
  while (cursor < stop) {
    const ymd = cursor.toISODate();
    if (ymd) out.push(ymd);
    if (grain === 'day') cursor = cursor.plus({ days: 1 });
    else if (grain === 'month') cursor = cursor.plus({ months: 1 });
    else cursor = cursor.plus({ years: 1 });
  }
  return out;
}

function streakFrom(today: string, marked: Set<string>): number {
  let n = 0;
  let cursor = today;
  while (marked.has(cursor)) {
    n += 1;
    cursor = ymdAdd(cursor, -1);
  }
  return n;
}

function isCarried(
  dueAt: Date | null,
  startAt: Date | null,
  periodStart: string,
  periodEnd: string,
  tz: string,
  periodEndInstant: Date,
): boolean {
  const anchor = dueAt ?? startAt;
  const inPeriod =
    anchor !== null &&
    localDate(anchor, tz) >= periodStart &&
    localDate(anchor, tz) < periodEnd;
  const overdue = dueAt !== null && dueAt.getTime() < periodEndInstant.getTime();
  return inPeriod || overdue;
}

export async function getReportOverview(
  user: UserProfile,
  type: ReportType,
  at?: string,
): Promise<ReportOverview> {
  const tz = user.timezone;
  const weekStartsOn = user.weekStartsOn;
  const anchor = parseAnchor(user, at);
  const today = DateTime.now().setZone(tz).startOf('day');
  const todayYmd = today.toISODate() ?? anchor.toISODate() ?? '';
  const period = currentPeriod(type, tz, weekStartsOn, anchor);
  const prevStart = previousPeriodStart(type, period.start, tz);
  const previous = currentPeriod(
    type,
    tz,
    weekStartsOn,
    DateTime.fromISO(prevStart, { zone: tz }),
  );
  const heat = heatmapRange(type, period.start, tz);
  const streakStart = today.minus({ days: 400 }).toISODate() ?? heat.start;
  const fetchStart = streakStart < heat.start ? streakStart : heat.start;
  const fetchEnd = todayYmd >= heat.end ? ymdAdd(todayYmd, 1) : heat.end;
  const fetchBounds = periodInstants(fetchStart, fetchEnd, tz);
  const periodBounds = periodInstants(period.start, period.end, tz);
  const completionRows = await getDb()
    .select({
      id: taskCompletions.id,
      taskId: taskCompletions.taskId,
      completedAt: taskCompletions.completedAt,
      title: tasks.title,
      priority: tasks.priority,
      listId: tasks.listId,
    })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(tasks.userId, user.id),
        gte(taskCompletions.completedAt, fetchBounds.start),
        lt(taskCompletions.completedAt, fetchBounds.end),
      ),
    )
    .orderBy(desc(taskCompletions.completedAt), desc(taskCompletions.id));

  const reportRows = await getDb()
    .select({
      type: reports.type,
      periodStart: reports.periodStart,
      bodyMd: reports.bodyMd,
    })
    .from(reports)
    .where(
      and(
        eq(reports.userId, user.id),
        inArray(reports.type, ['daily', type]),
        gte(reports.periodStart, fetchStart),
        lt(reports.periodStart, fetchEnd),
      ),
    );

  const completedByDay = new Map<string, number>();
  const recentDone: ReportRecentDone[] = [];
  const byPriority = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const listCounts = new Map<string, number>();
  let completed = 0;
  let prevCompleted = 0;
  for (const row of completionRows) {
    const ymd = localDate(row.completedAt, tz);
    completedByDay.set(ymd, (completedByDay.get(ymd) ?? 0) + 1);
    if (ymd >= period.start && ymd < period.end) {
      completed += 1;
      const p = asPriority(row.priority);
      byPriority[p] += 1;
      listCounts.set(row.listId, (listCounts.get(row.listId) ?? 0) + 1);
      if (recentDone.length < 5) {
        recentDone.push({
          taskId: row.taskId,
          title: row.title,
          completedAt: iso(row.completedAt),
          priority: p,
        });
      }
    }
    if (ymd >= previous.start && ymd < previous.end) prevCompleted += 1;
  }

  const wroteDaily = new Set<string>();
  const wroteByTypeStart = new Set<string>();
  for (const row of reportRows) {
    const rowType = row.type as ReportType;
    if (!hasWrote(row.bodyMd, rowType)) continue;
    if (rowType === 'daily') wroteDaily.add(row.periodStart);
    if (rowType === type) wroteByTypeStart.add(row.periodStart);
  }

  const wrote = wroteByTypeStart.has(period.start) ? 1 : 0;
  const prevWrote = wroteByTypeStart.has(previous.start) ? 1 : 0;

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
  let carried = 0;
  for (const task of openTasks) {
    if (isCarried(task.dueAt, task.startAt, period.start, period.end, tz, periodBounds.end)) {
      carried += 1;
    }
  }

  const [capturedRow] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, user.id),
        isNull(inboxItems.deletedAt),
        ne(inboxItems.status, 'archived'),
        gte(inboxItems.capturedAt, periodBounds.start),
        lt(inboxItems.capturedAt, periodBounds.end),
      ),
    );
  const captured = Number(capturedRow?.n ?? 0);

  const listIds = [...listCounts.keys()];
  const listName = new Map<string, string>();
  if (listIds.length > 0) {
    const listRows = await getDb()
      .select({ id: lists.id, name: lists.name, kind: lists.kind })
      .from(lists)
      .where(inArray(lists.id, listIds));
    for (const row of listRows) {
      listName.set(row.id, row.kind === 'inbox' ? '收集箱' : row.name);
    }
  }
  const byList: ReportListStat[] = [...listCounts.entries()]
    .map(([listId, count]) => ({ listId, name: listName.get(listId) ?? '列表', count }))
    .sort((a, b) => b.count - a.count || a.listId.localeCompare(b.listId))
    .slice(0, 3);

  const dates = enumerateCells(heat.grain, heat.start, heat.end);
  const heatmap: ReportHeatCell[] = dates.map((date) => {
    const key = cellKey(heat.grain, date);
    let completedN = 0;
    if (heat.grain === 'day') completedN = completedByDay.get(date) ?? 0;
    else {
      for (const [ymd, n] of completedByDay) {
        if (cellKey(heat.grain, ymd) === key) completedN += n;
      }
    }
    const wroteFlag =
      heat.grain === 'day' ? wroteDaily.has(date) : wroteByTypeStart.has(key);
    return { date: key, completed: completedN, wrote: wroteFlag };
  });

  return {
    type,
    period: { start: period.start, end: period.end, label: period.label },
    previousPeriod: { start: previous.start, end: previous.end, label: previous.label },
    totals: {
      completed,
      wrote,
      carried,
      captured,
      completedDelta: completed - prevCompleted,
      wroteDelta: wrote - prevWrote,
    },
    streaks: {
      completedDays: streakFrom(todayYmd, new Set(completedByDay.keys())),
      wroteDays: streakFrom(todayYmd, wroteDaily),
    },
    heatmap,
    heatmapGrain: heat.grain,
    recentDone,
    byPriority,
    byList,
  };
}

export async function getReportReview(user: UserProfile, id: string): Promise<ReportReview> {
  const row = await getOwnedReportOr404(user.id, id);
  const type = row.type as ReportType;
  const tz = user.timezone;
  const bounds = periodInstants(row.periodStart, row.periodEnd, tz);

  const completionRows = await getDb()
    .select({
      completionId: taskCompletions.id,
      taskId: taskCompletions.taskId,
      completedAt: taskCompletions.completedAt,
      title: tasks.title,
      priority: tasks.priority,
      status: tasks.status,
      dueAt: tasks.dueAt,
      listId: tasks.listId,
    })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(tasks.userId, user.id),
        gte(taskCompletions.completedAt, bounds.start),
        lt(taskCompletions.completedAt, bounds.end),
      ),
    )
    .orderBy(desc(taskCompletions.completedAt), desc(taskCompletions.id));

  const completed: ReportReviewTask[] = completionRows.map((item) => ({
    taskId: item.taskId,
    title: item.title,
    priority: asPriority(item.priority),
    status: asStatus(item.status),
    dueAt: item.dueAt ? iso(item.dueAt) : null,
    completedAt: iso(item.completedAt),
    completionId: item.completionId,
    listId: item.listId,
  }));

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
  const carried: ReportReviewTask[] = openTasks
    .filter((task) =>
      isCarried(task.dueAt, task.startAt, row.periodStart, row.periodEnd, tz, bounds.end),
    )
    .sort((a, b) => {
      const da = a.dueAt?.getTime() ?? a.startAt?.getTime() ?? 0;
      const db = b.dueAt?.getTime() ?? b.startAt?.getTime() ?? 0;
      if (da !== db) return da - db;
      return a.id.localeCompare(b.id);
    })
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      priority: asPriority(task.priority),
      status: asStatus(task.status),
      dueAt: task.dueAt ? iso(task.dueAt) : null,
      completedAt: null,
      completionId: null,
      listId: task.listId,
    }));

  const inboxRows = await getDb()
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, user.id),
        isNull(inboxItems.deletedAt),
        ne(inboxItems.status, 'archived'),
        gte(inboxItems.capturedAt, bounds.start),
        lt(inboxItems.capturedAt, bounds.end),
      ),
    )
    .orderBy(inboxItems.capturedAt, inboxItems.id);

  const captured: ReportReviewInbox[] = inboxRows.map((item) => ({
    inboxId: item.id,
    title: item.title,
    status: asInboxStatus(item.status),
    capturedAt: iso(item.capturedAt),
  }));

  return {
    reportId: row.id,
    type,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    completed,
    carried,
    captured,
  };
}
