import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { OutcomeSignal } from '@vital/dto';
import { getUserEntity } from '../auth/auth.service.js';
import { getDb } from '../db/index.js';
import { outcomes, taskCompletions, tasks } from '../db/schema.js';
import {
  linkedHabitFacts,
  loadHabitHeadlineFacts,
  type HabitHeadlineFact,
} from '../habits/progress.js';
import type { OutcomeStats } from './outcome-dto.js';
import {
  computeSignal,
  isOverdue,
  selectRuleNextStep,
  STALE_DAYS,
  type NextStepTask,
  type OutcomeFacts,
} from './rule-engine.js';

interface OpenRuleTask extends NextStepTask {
  outcomeId: string;
  habitId: string | null;
  calendarKey: string | null;
}

interface MilestoneRuleTask {
  status: string;
  updatedAt: Date;
}

interface OutcomeRuleContext {
  openByOutcome: Map<string, OpenRuleTask[]>;
  completionsByOutcome: Map<string, Date[]>;
  lastTaskActivityByOutcome: Map<string, Date | null>;
  milestonesByOutcome: Map<string, MilestoneRuleTask[]>;
}

interface OutcomeRuleFields {
  ruleSignal: OutcomeSignal;
  ruleNextStep: string | null;
  lastActivityAt: Date | null;
}

function asInstant(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a > b ? a : b;
  return a ?? b;
}

/** Open tasks, 14d completions, and last activity — one query each, grouped in memory. */
export async function loadOutcomeRuleContext(
  userId: string,
  outcomeIds: string[],
  now: Date,
): Promise<OutcomeRuleContext> {
  const openByOutcome = new Map<string, OpenRuleTask[]>();
  const completionsByOutcome = new Map<string, Date[]>();
  const lastTaskActivityByOutcome = new Map<string, Date | null>();
  const milestonesByOutcome = new Map<string, MilestoneRuleTask[]>();
  for (const id of outcomeIds) {
    openByOutcome.set(id, []);
    completionsByOutcome.set(id, []);
    lastTaskActivityByOutcome.set(id, null);
    milestonesByOutcome.set(id, []);
  }
  if (outcomeIds.length === 0) {
    return { openByOutcome, completionsByOutcome, lastTaskActivityByOutcome, milestonesByOutcome };
  }

  const openRows = await getDb()
    .select({
      outcomeId: tasks.outcomeId,
      title: tasks.title,
      status: tasks.status,
      dueAt: tasks.dueAt,
      priority: tasks.priority,
      isAllDay: tasks.isAllDay,
      habitId: tasks.habitId,
      calendarKey: tasks.calendarKey,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.outcomeId, outcomeIds),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['todo', 'doing']),
      ),
    );
  for (const row of openRows) {
    if (!row.outcomeId) continue;
    const list = openByOutcome.get(row.outcomeId);
    if (!list) continue;
    list.push({
      outcomeId: row.outcomeId,
      title: row.title,
      status: row.status,
      dueAt: row.dueAt,
      priority: row.priority,
      isAllDay: row.isAllDay,
      habitId: row.habitId,
      calendarKey: row.calendarKey,
    });
  }

  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  const doneRows = await getDb()
    .select({ outcomeId: tasks.outcomeId, completedAt: taskCompletions.completedAt })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.outcomeId, outcomeIds),
        isNull(tasks.calendarKey),
        gte(taskCompletions.completedAt, twoWeeksAgo),
      ),
    );
  for (const row of doneRows) {
    if (!row.outcomeId) continue;
    const at = asInstant(row.completedAt);
    if (!at) continue;
    const list = completionsByOutcome.get(row.outcomeId);
    if (list) list.push(at);
  }

  const activityRows = await getDb()
    .select({
      outcomeId: tasks.outcomeId,
      last: sql<Date | string | null>`max(${tasks.updatedAt})`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.outcomeId, outcomeIds),
        isNull(tasks.deletedAt),
        isNull(tasks.calendarKey),
      ),
    )
    .groupBy(tasks.outcomeId);
  for (const row of activityRows) {
    if (!row.outcomeId) continue;
    lastTaskActivityByOutcome.set(row.outcomeId, asInstant(row.last));
  }

  const milestoneRows = await getDb()
    .select({
      outcomeId: tasks.outcomeId,
      status: tasks.status,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.outcomeId, outcomeIds),
        eq(tasks.isMilestone, true),
        isNull(tasks.deletedAt),
        isNull(tasks.habitId),
      ),
    );
  for (const row of milestoneRows) {
    if (!row.outcomeId) continue;
    milestonesByOutcome.get(row.outcomeId)?.push({ status: row.status, updatedAt: row.updatedAt });
  }

  return { openByOutcome, completionsByOutcome, lastTaskActivityByOutcome, milestonesByOutcome };
}

export function ruleFieldsForOutcome(
  outcomeId: string,
  ctx: OutcomeRuleContext,
  habitFacts: HabitHeadlineFact[],
  now: Date,
  timezone: string,
): OutcomeRuleFields {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const openTasks = (ctx.openByOutcome.get(outcomeId) ?? []).filter(
    (task) => task.calendarKey === null,
  );
  const doneAt = ctx.completionsByOutcome.get(outcomeId) ?? [];
  const completedLast7d = doneAt.filter((at) => at >= weekAgo).length;
  const completedPrev7d = doneAt.length - completedLast7d;
  const lastDone = doneAt.reduce<Date | null>(
    (acc, at) => (acc === null || at > acc ? at : acc),
    null,
  );
  const lastActivityAt = laterOf(ctx.lastTaskActivityByOutcome.get(outcomeId) ?? null, lastDone);

  const linkedHabits = linkedHabitFacts(habitFacts, outcomeId);
  const habitDaysLast7d = linkedHabits.reduce((sum, habit) => sum + habit.daysDoneLast7d, 0);
  const habitDaysPrev7d = linkedHabits.reduce((sum, habit) => sum + habit.daysDonePrev7d, 0);
  const habitLast = linkedHabits.reduce<Date | null>((acc, habit) => {
    if (!habit.lastCompletedAt) return acc;
    return acc === null || habit.lastCompletedAt > acc ? habit.lastCompletedAt : acc;
  }, null);
  const lastActivityWithHabits = laterOf(lastActivityAt, habitLast);
  const incompleteHabit = linkedHabits.find((habit) => habit.todayDone < habit.todayTarget);

  const milestones = ctx.milestonesByOutcome.get(outcomeId) ?? [];
  const staleBefore = now.getTime() - STALE_DAYS * 24 * 3600 * 1000;
  const milestoneStaleOpen = milestones.filter(
    (task) =>
      (task.status === 'todo' || task.status === 'doing') && task.updatedAt.getTime() < staleBefore,
  ).length;
  const facts: OutcomeFacts = {
    completedLast7d: completedLast7d + habitDaysLast7d,
    completedPrev7d: completedPrev7d + habitDaysPrev7d,
    openCount: openTasks.length,
    overdueCount: openTasks.filter((t) => isOverdue(t.dueAt, t.isAllDay, now, timezone)).length,
    lastActivityAt: lastActivityWithHabits,
    ...(milestones.some((task) => task.status !== 'canceled') ? { milestoneStaleOpen } : {}),
  };

  return {
    ruleSignal: computeSignal(facts, now),
    ruleNextStep: selectRuleNextStep(openTasks, now, timezone) ?? incompleteHabit?.name ?? null,
    lastActivityAt: lastActivityWithHabits,
  };
}

export function statsFromRuleContext(
  outcomeIds: string[],
  ctx: OutcomeRuleContext,
  habitFacts: HabitHeadlineFact[],
  materialCounts: Map<string, number>,
  now: Date,
): Map<string, OutcomeStats> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const map = new Map<string, OutcomeStats>();
  for (const id of outcomeIds) {
    const openCount = (ctx.openByOutcome.get(id) ?? []).filter(
      (task) => task.habitId === null && task.calendarKey === null,
    ).length;
    const completedLast7d = (ctx.completionsByOutcome.get(id) ?? []).filter(
      (at) => at >= weekAgo,
    ).length;
    const habitDays = linkedHabitFacts(habitFacts, id).reduce(
      (sum, habit) => sum + habit.daysDoneLast7d,
      0,
    );
    const milestones = (ctx.milestonesByOutcome.get(id) ?? []).filter(
      (task) => task.status !== 'canceled',
    );
    map.set(id, {
      openTaskCount: openCount,
      completedLast7d: completedLast7d + habitDays,
      materialCount: materialCounts.get(id) ?? 0,
      milestoneDone: milestones.filter((task) => task.status === 'done').length,
      milestoneTotal: milestones.length,
    });
  }
  return map;
}

/** Recompute and store the deterministic rule-layer fields for one thread. */
export async function refreshOutcomeRuleFields(
  userId: string,
  outcomeId: string,
  now = new Date(),
): Promise<void> {
  // All-day overdue checks are calendar-date based, so the user's zone matters here.
  const timezone = (await getUserEntity(userId)).timezone;
  const habitFacts = await loadHabitHeadlineFacts(userId, timezone, now);
  const ctx = await loadOutcomeRuleContext(userId, [outcomeId], now);
  const fields = ruleFieldsForOutcome(outcomeId, ctx, habitFacts, now, timezone);

  await getDb()
    .update(outcomes)
    .set({
      ruleSignal: fields.ruleSignal,
      ruleNextStep: fields.ruleNextStep,
      ruleUpdatedAt: now,
      lastActivityAt: fields.lastActivityAt,
      updatedAt: now,
    })
    .where(eq(outcomes.id, outcomeId));
}

/** Recompute rule fields for the thread a task belongs to (and its previous thread). */
export async function refreshOutcomeRulesForTask(
  userId: string,
  outcomeId: string | null,
  previousOutcomeId?: string | null,
): Promise<void> {
  if (outcomeId) await refreshOutcomeRuleFields(userId, outcomeId);
  if (previousOutcomeId && previousOutcomeId !== outcomeId) {
    await refreshOutcomeRuleFields(userId, previousOutcomeId);
  }
}
