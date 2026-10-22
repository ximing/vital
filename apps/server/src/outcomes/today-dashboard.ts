import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { TodayDashboard, TodayPulse } from '@vital/dto';
import { readTodayLayout } from '../agent/today-layout.js';
import { getUserEntity } from '../auth/auth.service.js';
import { getDb } from '../db/index.js';
import { habits, inboxItems, outcomes, reports } from '../db/schema.js';
import { upcomingDay } from '../days/days.service.js';
import { expireStaleHabitInstances } from '../habits/habits.service.js';
import { linkedHabitFacts, loadHabitHeadlineFacts } from '../habits/progress.js';
import { listTasks } from '../tasks/tasks.service.js';
import { showsOnTodayBoard } from './board.js';
import { computeNow } from './now-engine.js';
import { asSignal, loadMaterialCounts, toOutcomeDto } from './outcome-dto.js';
import {
  loadOutcomeRuleContext,
  ruleFieldsForOutcome,
  statsFromRuleContext,
} from './rule-context.js';

async function todayPulse(userId: string, timezone: string): Promise<TodayPulse> {
  const [inboxRow] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        eq(inboxItems.status, 'unread'),
        isNull(inboxItems.deletedAt),
      ),
    );

  const daily = await getDb()
    .select({ id: reports.id, periodStart: reports.periodStart })
    .from(reports)
    .where(and(eq(reports.userId, userId), eq(reports.type, 'daily'), ne(reports.bodyMd, '')))
    .orderBy(desc(reports.periodStart))
    .limit(120);
  const today = DateTime.now().setZone(timezone).toISODate();
  const written = new Set(daily.map((r) => r.periodStart));
  let streak = 0;
  let cursor = today;
  if (cursor && !written.has(cursor)) {
    // Today isn't written yet — don't break the streak, start from yesterday.
    cursor = DateTime.fromISO(cursor).minus({ days: 1 }).toISODate();
  }
  while (cursor && written.has(cursor)) {
    streak += 1;
    cursor = DateTime.fromISO(cursor).minus({ days: 1 }).toISODate();
  }

  return {
    inboxPending: inboxRow?.n ?? 0,
    reportStreak: streak,
    todayReportId:
      today && written.has(today) ? (daily.find((r) => r.periodStart === today)?.id ?? null) : null,
    upcomingDay: await upcomingDay(userId, timezone),
  };
}

export async function getTodayDashboard(userId: string, timezone: string): Promise<TodayDashboard> {
  const now = new Date();
  const rows = await getDb()
    .select()
    .from(outcomes)
    .where(and(eq(outcomes.userId, userId), eq(outcomes.status, 'open')))
    .orderBy(asc(outcomes.sortOrder), asc(outcomes.createdAt));
  const outcomeIds = rows.map((r) => r.id);

  // Compute in memory: overdue / habit-today depend on `now`, so a write would still go stale.
  const [entity, habitFacts, ctx, materialCounts] = await Promise.all([
    getUserEntity(userId),
    loadHabitHeadlineFacts(userId, timezone, now),
    loadOutcomeRuleContext(userId, outcomeIds, now),
    loadMaterialCounts(userId, outcomeIds),
  ]);
  const stats = statsFromRuleContext(outcomeIds, ctx, habitFacts, materialCounts, now);
  const fresh = rows.map((row) => {
    const fields = ruleFieldsForOutcome(row.id, ctx, habitFacts, now, timezone);
    return {
      ...row,
      ruleSignal: fields.ruleSignal,
      ruleNextStep: fields.ruleNextStep,
      lastActivityAt: fields.lastActivityAt,
    };
  });

  await expireStaleHabitInstances(userId, timezone, now);
  const [todayTasks, pulse, habitWindowRows, layout] = await Promise.all([
    listTasks(userId, { listId: 'smart:today', limit: 100 }).then((r) => r.items),
    todayPulse(userId, timezone),
    getDb()
      .select({ start: habits.windowStart, end: habits.windowEnd })
      .from(habits)
      .where(and(eq(habits.userId, userId), eq(habits.active, true))),
    readTodayLayout(userId),
  ]);

  // "当下" card: rule layer only for now; the agent layer may later rewrite the reason.
  const signalByOutcome = new Map(fresh.map((row) => [row.id, asSignal(row.ruleSignal)]));
  const nowCard = computeNow({
    now,
    timezone,
    tasks: todayTasks
      .filter((task) => task.habitId === null)
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        estimateMinutes: task.estimateMinutes,
        dueAt: task.dueAt ? new Date(task.dueAt) : null,
        isAllDay: task.isAllDay,
        agentScheduled: task.agentScheduled === true,
        startAt: task.startAt ? new Date(task.startAt) : null,
        outcomeId: task.outcomeId,
        outcomeSignal: task.outcomeId ? (signalByOutcome.get(task.outcomeId) ?? null) : null,
      })),
    habitWindows: habitWindowRows.flatMap((row) =>
      row.start !== null && row.end !== null ? [{ start: row.start, end: row.end }] : [],
    ),
    quietHoursStart: entity.quietHoursStart,
    quietHoursEnd: entity.quietHoursEnd,
  });

  return {
    outcomes: fresh.flatMap((row) => {
      const open = ctx.openByOutcome.get(row.id) ?? [];
      const realOpen = open.filter(
        (task) => task.habitId === null && task.calendarKey === null,
      ).length;
      const linkedHabits = linkedHabitFacts(habitFacts, row.id).filter(
        (habit) => habit.active,
      ).length;
      if (!showsOnTodayBoard({ createdBy: row.createdBy, realOpen, linkedHabits })) return [];
      return [toOutcomeDto(row, stats.get(row.id))];
    }),
    tasks: todayTasks,
    pulse,
    now: nowCard,
    layout,
    generatedAt: now.toISOString(),
  };
}
