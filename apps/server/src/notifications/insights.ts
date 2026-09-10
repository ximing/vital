import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, isNull, like, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { agentJobs, habits, notificationOutbox, outcomes, reports, taskCompletions, tasks, type User } from '../db/schema.js';
import { currentAgentJob, LostAgentJobLeaseError, ownsAgentJob } from '../agent/job-runtime.js';

export type InsightKind = 'outcome.stale' | 'task.decompose' | 'habit.window' | 'review.missing';
export interface InsightCandidate { kind: InsightKind; targetType: 'outcome' | 'task' | 'habit'; targetId: string; title: string; message: string }
export interface InsightFacts {
  now: Date; timezone: string;
  outcomes: Array<{ id: string; name: string; ruleSignal: string | null; lastActivityAt: Date | null }>;
  tasks: Array<{ id: string; title: string; deferCount: number; outcomeId: string | null }>;
  habits: Array<{ id: string; name: string; kind: string; targetCount: number | null; windowEnd: string | null; done: number }>;
  dailyReportWritten: boolean; completedToday: number;
}

export function selectInsightCandidates(facts: InsightFacts): InsightCandidate[] {
  const local = DateTime.fromJSDate(facts.now).setZone(facts.timezone);
  const out: InsightCandidate[] = [];
  const staleBefore = facts.now.getTime() - 2 * 24 * 3600_000;
  for (const row of facts.outcomes) {
    if (row.ruleSignal === 'alert' && (row.lastActivityAt?.getTime() ?? 0) <= staleBefore) out.push({ kind: 'outcome.stale', targetType: 'outcome', targetId: row.id, title: row.name, message: `「${row.name}」已经两天没推进了，今天要不要动一小步？` });
  }
  for (const row of facts.tasks) {
    if (row.deferCount >= 3) out.push({ kind: 'task.decompose', targetType: 'task', targetId: row.id, title: row.title, message: `「${row.title}」已经推迟 ${String(row.deferCount)} 次了，要不要拆小一点？` });
  }
  for (const row of facts.habits) {
    if (row.kind !== 'count' || !row.targetCount || !row.windowEnd || row.done >= row.targetCount) continue;
    const end = DateTime.fromISO(`${local.toISODate() ?? ''}T${row.windowEnd}`, { zone: facts.timezone });
    const minutes = end.diff(local, 'minutes').minutes;
    if (minutes > 0 && minutes <= 60) out.push({ kind: 'habit.window', targetType: 'habit', targetId: row.id, title: row.name, message: `今天${row.name} ${String(row.done)}/${String(row.targetCount)}，窗口还剩 1 小时。` });
  }
  if (local.hour >= 21 && facts.completedToday > 0 && !facts.dailyReportWritten) out.push({ kind: 'review.missing', targetType: 'outcome', targetId: '00000000-0000-0000-0000-000000000000', title: '今日复盘', message: `今天完成了 ${String(facts.completedToday)} 个任务，还没写复盘。花两分钟收个尾吧。` });
  return out;
}

async function factsFor(user: User, now: Date): Promise<InsightFacts> {
  const local = DateTime.fromJSDate(now).setZone(user.timezone);
  const day = local.toISODate() ?? now.toISOString().slice(0, 10);
  const start = local.startOf('day').toUTC().toJSDate();
  const end = local.plus({ days: 1 }).startOf('day').toUTC().toJSDate();
  const db = getDb();
  const [outcomeRows, taskRows, habitRows, reportRows, completionRows] = await Promise.all([
    db.select({ id: outcomes.id, name: outcomes.name, ruleSignal: outcomes.ruleSignal, lastActivityAt: outcomes.lastActivityAt }).from(outcomes).where(and(eq(outcomes.userId, user.id), eq(outcomes.status, 'open'))),
    db.select({ id: tasks.id, title: tasks.title, deferCount: tasks.deferCount, outcomeId: tasks.outcomeId }).from(tasks).where(and(eq(tasks.userId, user.id), isNull(tasks.deletedAt), inArray(tasks.status, ['todo', 'doing']))),
    db.select().from(habits).where(and(eq(habits.userId, user.id), eq(habits.active, true))),
    db.select({ bodyMd: reports.bodyMd }).from(reports).where(and(eq(reports.userId, user.id), eq(reports.type, 'daily'), eq(reports.periodStart, day))).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(taskCompletions).innerJoin(tasks, eq(tasks.id, taskCompletions.taskId)).where(and(eq(tasks.userId, user.id), gte(taskCompletions.completedAt, start), sql`${taskCompletions.completedAt} < ${end}`)),
  ]);
  const habitFacts = [];
  for (const habit of habitRows) {
    const [progress] = await db.select({ done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int` }).from(tasks).where(and(eq(tasks.userId, user.id), eq(tasks.habitId, habit.id), like(tasks.habitKey, `${habit.id}:${day}:%`)));
    habitFacts.push({ id: habit.id, name: habit.name, kind: habit.kind, targetCount: habit.targetCount, windowEnd: habit.windowEnd, done: progress?.done ?? 0 });
  }
  return { now, timezone: user.timezone, outcomes: outcomeRows, tasks: taskRows, habits: habitFacts, dailyReportWritten: Boolean(reportRows[0]?.bodyMd.trim()), completedToday: completionRows[0]?.n ?? 0 };
}

export async function enqueueProactiveInsights(user: User, now = new Date(), rewrite?: (item: InsightCandidate) => Promise<string | null>): Promise<number> {
  if (!user.notifyAgentInsights) return 0;
  const day = DateTime.fromJSDate(now).setZone(user.timezone).toFormat('yyyyLLdd');
  const candidates = selectInsightCandidates(await factsFor(user, now));
  let inserted = 0;
  for (const item of candidates) {
    // Reserve before model work. The persisted rule message is also the crash
    // fallback: the dispatcher recovers abandoned preparation without another
    // paid rewrite or relying on the candidate still appearing in a later scan.
    const payload = { title: item.title, listId: '', listName: '', dueAt: null, remindAt: null, isAllDay: false, timezone: user.timezone, eventType: 'agent.insight' as const, insightKind: item.kind, message: item.message };
    const job = currentAgentJob();
    if (job && job.userId !== user.id) throw new Error('notification job user mismatch');
    const rows = await getDb().transaction(async (tx) => {
      if (job) {
        const [owned] = await tx.select({ id: agentJobs.id }).from(agentJobs).where(ownsAgentJob(job)).for('share');
        if (!owned) throw new LostAgentJobLeaseError();
      }
      return tx.insert(notificationOutbox).values({ id: randomUUID(), userId: user.id, eventType: 'agent.insight', entityType: item.targetType, entityId: item.targetId, occurrenceAt: now, idempotencyKey: `insight:${user.id}:${item.kind}:${item.targetId}:${day}`, scheduledAt: now, status: 'preparing', payload, createdAt: now, updatedAt: new Date() }).onConflictDoNothing().returning({ id: notificationOutbox.id });
    });
    if (!rows[0]) continue;
    try {
      payload.message = (await rewrite?.(item))?.trim().slice(0, 500) || item.message;
    } finally {
      await getDb().update(notificationOutbox).set({ payload, status: 'pending', updatedAt: new Date() })
        .where(and(eq(notificationOutbox.id, rows[0].id), eq(notificationOutbox.userId, user.id), eq(notificationOutbox.status, 'preparing'),
          job ? sql`EXISTS (SELECT 1 FROM ${agentJobs} WHERE ${ownsAgentJob(job)})` : undefined));
    }
    inserted += rows.length;
  }
  return inserted;
}

export async function insightStillEligible(user: User, targetId: string, kind: InsightKind, now: Date): Promise<boolean> {
  if (!user.notifyAgentInsights) return false;
  return selectInsightCandidates(await factsFor(user, now)).some((row) => row.kind === kind && row.targetId === targetId);
}
