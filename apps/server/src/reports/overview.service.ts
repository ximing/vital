import {
  hasWrote,
  type InboxStatus,
  type ReportCarriedTask,
  type ReportHeatCell,
  type ReportListStat,
  type ReportOverview,
  type ReportRecentDone,
  type ReportReview,
  type ReportReviewInbox,
  type ReportReviewTask,
  type ReportType,
  type TaskStatus,
} from '@vital/dto';
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getDb } from '../db/index.js';
import { inboxItems, lists, reports, taskCompletions, tasks } from '../db/schema.js';
import { AppError } from '../errors.js';
import { asPriority, carriedWithLiveState, computeCarriedTasks, isCarried } from './carry.js';
import { currentPeriod, localDate, periodInstants, previousPeriodStart } from './period.js';
import {
  freezeIfNeeded,
  getOwnedReportOr404,
  isReportSnapshot,
  loadReportClock,
  type ReportClock,
} from './reports.service.js';

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

function parseAnchor(user: ReportClock, at?: string): DateTime {
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

export async function getReportOverview(
  userId: string,
  type: ReportType,
  at?: string,
): Promise<ReportOverview> {
  const user = await loadReportClock(userId);
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
  const captured = capturedRow?.n ?? 0;

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

export async function getReportReview(userId: string, id: string): Promise<ReportReview> {
  const user = await loadReportClock(userId);
  let row = await getOwnedReportOr404(user.id, id);
  const type = row.type as ReportType;
  const tz = user.timezone;
  const bounds = periodInstants(row.periodStart, row.periodEnd, tz);

  // Lazy freeze: the period has closed but no snapshot exists yet — freeze the
  // carried list now, as of this read, so it stops drifting with live edits.
  const todayYmd = DateTime.now().setZone(tz).startOf('day').toISODate() ?? '';
  const periodEnded = row.periodEnd <= todayYmd;
  if (periodEnded && row.snapshotAt === null) {
    await freezeIfNeeded(row);
    row = await getOwnedReportOr404(user.id, id);
  }

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

  // Ended period: the frozen list, overlaid with each task's live state — a
  // task completed after the freeze stays, annotated with when. Current
  // period: live query, as before.
  const snapshot =
    row.snapshotJson && isReportSnapshot(row.snapshotJson) ? row.snapshotJson : null;
  let carried: ReportCarriedTask[];
  if (periodEnded && snapshot) {
    carried = await carriedWithLiveState(user.id, snapshot.carried);
  } else {
    carried = await computeCarriedTasks(user.id, user, row.periodStart, row.periodEnd);
  }

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
