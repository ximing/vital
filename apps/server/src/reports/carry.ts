import type { ReportCarriedTask, ReportSnapshotCarriedTask, TaskPriority } from '@vital/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { taskCompletions, tasks } from '../db/schema.js';
import { localDate, periodInstants } from './period.js';
import type { ReportClock } from './reports.service.js';

export function asPriority(value: number): TaskPriority {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  return 3;
}

export function isCarried(
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

/** Open tasks carried by the period: anchored in it or overdue before its end. */
async function openCarriedRows(
  userId: string,
  clock: ReportClock,
  periodStart: string,
  periodEnd: string,
) {
  const bounds = periodInstants(periodStart, periodEnd, clock.timezone);
  const openTasks = await getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['todo', 'doing']),
      ),
    );
  return openTasks
    .filter((task) =>
      isCarried(task.dueAt, task.startAt, periodStart, periodEnd, clock.timezone, bounds.end),
    )
    .sort((a, b) => {
      const da = a.dueAt?.getTime() ?? a.startAt?.getTime() ?? 0;
      const db = b.dueAt?.getTime() ?? b.startAt?.getTime() ?? 0;
      if (da !== db) return da - db;
      return a.id.localeCompare(b.id);
    });
}

/** Live carried list for the current (still-open) period. */
export async function computeCarriedTasks(
  userId: string,
  clock: ReportClock,
  periodStart: string,
  periodEnd: string,
): Promise<ReportCarriedTask[]> {
  const rows = await openCarriedRows(userId, clock, periodStart, periodEnd);
  return rows.map((task) => ({
    taskId: task.id,
    title: task.title,
    priority: asPriority(task.priority),
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    listId: task.listId,
    status: task.status as ReportCarriedTask['status'],
    completedAt: null,
    completionId: null,
    deleted: false,
  }));
}

/** Frozen carried facts for the snapshot — live state is stripped. */
export async function computeCarriedSnapshot(
  userId: string,
  clock: ReportClock,
  periodStart: string,
  periodEnd: string,
): Promise<ReportSnapshotCarriedTask[]> {
  const rows = await openCarriedRows(userId, clock, periodStart, periodEnd);
  return rows.map((task) => ({
    taskId: task.id,
    title: task.title,
    priority: asPriority(task.priority),
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    listId: task.listId,
  }));
}

/**
 * Frozen carried list overlaid with each task's state now: a task completed
 * after the freeze stays in the list, annotated with when it was done.
 */
export async function carriedWithLiveState(
  userId: string,
  frozen: ReportSnapshotCarriedTask[],
): Promise<ReportCarriedTask[]> {
  const ids = frozen.map((item) => item.taskId);
  if (ids.length === 0) return [];
  const taskRows = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)));
  const byId = new Map(taskRows.map((row) => [row.id, row]));

  const completionRows = await getDb()
    .select({
      taskId: taskCompletions.taskId,
      completionId: taskCompletions.id,
      completedAt: taskCompletions.completedAt,
    })
    .from(taskCompletions)
    .where(inArray(taskCompletions.taskId, ids))
    .orderBy(taskCompletions.completedAt, taskCompletions.id);
  const latestCompletion = new Map<string, { completionId: string; completedAt: Date }>();
  for (const row of completionRows) {
    latestCompletion.set(row.taskId, {
      completionId: row.completionId,
      completedAt: row.completedAt,
    });
  }

  return frozen.map((item) => {
    const task = byId.get(item.taskId);
    if (!task) {
      return { ...item, status: 'todo', completedAt: null, completionId: null, deleted: true };
    }
    const done = task.status === 'done' && task.deletedAt === null;
    const latest = latestCompletion.get(item.taskId);
    return {
      ...item,
      status: task.status as ReportCarriedTask['status'],
      completedAt: done
        ? ((task.completedAt ?? latest?.completedAt)?.toISOString() ?? null)
        : null,
      completionId: done ? (latest?.completionId ?? null) : null,
      deleted: task.deletedAt !== null,
    };
  });
}
