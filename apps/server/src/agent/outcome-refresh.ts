import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  agentActions,
  habits,
  outcomes,
  taskCompletions,
  tasks,
  type AgentJobRow,
  type User,
} from '../db/schema.js';
import {
  linkedHabitFacts,
  loadHabitHeadlineFacts,
  unlinkedHabitFacts,
} from '../habits/progress.js';
import { milestoneProgress, withMilestoneHeadline } from '../outcomes/milestones.js';
import { isOverdue } from '../outcomes/rule-engine.js';
import { recordAgentAction, retireOlderPending } from './action-ledger.js';
import { executionResult, skipExecution } from './executions.service.js';
import { loadAgentMemory, runWithCritic } from './harness.js';
import { withAgentJobEffects } from './job-runtime.js';
import { iso } from './processor-shared.js';
import type { AgentJobResult } from './processors.js';
import { buildHeadlinePrompt } from './prompts.js';
import { submitHeadlineTool, type SubmitHeadlineArgs } from './tools.js';
import { asTime, isStaleWording, planWordingUpdate, shouldRefreshWording } from './wording.js';

/** No model call. Clears a stale count or filler sentence and keeps the rule line. */
async function settleQuietRefresh(
  job: AgentJobRow,
  userId: string,
  outcomeId: string,
  now: Date,
  milestoneTotal: number,
): Promise<void> {
  await withAgentJobEffects(job, async (tx) => {
    const [current] = await tx
      .select()
      .from(outcomes)
      .where(and(eq(outcomes.id, outcomeId), eq(outcomes.userId, userId), eq(outcomes.status, 'open')))
      .limit(1)
      .for('update');
    if (!current) return;
    const clearHeadline =
      current.agentHeadline !== null && isStaleWording(current.agentHeadline, milestoneTotal);
    const clearSuggestion =
      current.agentSuggestion !== null && isStaleWording(current.agentSuggestion, 0);
    await tx
      .update(outcomes)
      .set({
        agentState: 'idle',
        agentUpdatedAt: now,
        updatedAt: now,
        ...(clearHeadline ? { agentHeadline: null } : {}),
        ...(clearSuggestion ? { agentSuggestion: null } : {}),
      })
      .where(and(eq(outcomes.id, outcomeId), eq(outcomes.userId, userId)));
  });
}

/** Real task edits only. Habit check-ins and calendar rows do not reopen a proposal. */
async function realTaskChangedSinceWording(
  userId: string,
  outcomeId: string,
  agentUpdatedAt: Date | null,
): Promise<boolean> {
  const db = getDb();
  const [factRow] = await db
    .select({ latest: sql<string | null>`max(${tasks.updatedAt})` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.outcomeId, outcomeId),
        isNull(tasks.deletedAt),
        isNull(tasks.calendarKey),
        isNull(tasks.habitId),
      ),
    );
  const [feedbackRow] = await db
    .select({ latest: sql<string | null>`max(${agentActions.feedbackAt})` })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.userId, userId),
        eq(agentActions.targetType, 'outcome'),
        eq(agentActions.targetId, outcomeId),
        inArray(agentActions.actionType, ['outcome.headline', 'outcome.suggestion']),
        inArray(agentActions.feedback, ['accepted', 'dismissed', 'edited']),
        sql`coalesce(${agentActions.feedbackPayload}->>'superseded', '') <> 'true'`,
      ),
    );
  return shouldRefreshWording({
    agentUpdatedAt,
    lastFeedbackAt: asTime(feedbackRow?.latest),
    latestFactAt: asTime(factRow?.latest),
  });
}

export async function processOutcomeRefresh(
  job: AgentJobRow,
  user: User,
  now: Date,
): Promise<AgentJobResult> {
  if (!('outcomeId' in job.payload)) return 'done';
  const outcomeId = job.payload.outcomeId;
  const db = getDb();
  const [outcome] = await db.select().from(outcomes).where(and(eq(outcomes.id, outcomeId), eq(outcomes.userId, user.id))).limit(1);
  if (!outcome || outcome.userId !== user.id || outcome.status !== 'open') return 'done';

  const openTasks = await db
    .select({
      title: tasks.title,
      dueAt: tasks.dueAt,
      estimateMinutes: tasks.estimateMinutes,
      isAllDay: tasks.isAllDay,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        eq(tasks.outcomeId, outcomeId),
        isNull(tasks.deletedAt),
        isNull(tasks.calendarKey),
        isNull(tasks.habitId),
        inArray(tasks.status, ['todo', 'doing']),
      ),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(50);

  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const [doneRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(tasks.userId, user.id),
        eq(tasks.outcomeId, outcomeId),
        isNull(tasks.calendarKey),
        isNull(tasks.habitId),
        gte(taskCompletions.completedAt, weekAgo),
      ),
    );

  const milestoneRows = await db
    .select({ status: tasks.status, isMilestone: tasks.isMilestone })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        eq(tasks.outcomeId, outcomeId),
        eq(tasks.isMilestone, true),
        isNull(tasks.deletedAt),
        isNull(tasks.habitId),
      ),
    );
  const milestone = milestoneProgress(milestoneRows);
  const habitFacts = await loadHabitHeadlineFacts(user.id, user.timezone, now);
  const linkedHabits = linkedHabitFacts(habitFacts, outcomeId);
  const unlinkedHabits = unlinkedHabitFacts(habitFacts);
  if (openTasks.length === 0 && linkedHabits.length === 0 && unlinkedHabits.length === 0) {
    await settleQuietRefresh(job, user.id, outcomeId, now, milestone.total);
    skipExecution('NO_CHANGES');
    return 'done';
  }
  if (!(await realTaskChangedSinceWording(user.id, outcomeId, outcome.agentUpdatedAt))) {
    await settleQuietRefresh(job, user.id, outcomeId, now, milestone.total);
    skipExecution('UNCHANGED_INPUT');
    return 'done';
  }
  const memory = await loadAgentMemory(user.id, 'headline', outcome.name);
  executionResult({
    inputSummary: `仅当前用户：线程内 ${String(openTasks.length)} 项未完成任务，${String(linkedHabits.length)} 个已挂载习惯，${String(memory.length)} 条记忆`,
  });
  const prompt = buildHeadlinePrompt({
    outcomeName: outcome.name,
    ruleSignal: outcome.ruleSignal,
    ruleNextStep: outcome.ruleNextStep,
    completedLast7d: doneRow?.n ?? 0,
    openTasks: openTasks.map((t) => ({
      title: t.title,
      dueAt: iso(t.dueAt),
      overdue: isOverdue(t.dueAt, t.isAllDay, now, user.timezone),
      estimateMinutes: t.estimateMinutes,
    })),
    memory: memory.map((m) => m.content),
    linkedHabits: linkedHabits.map((habit) => ({
      id: habit.id,
      name: habit.name,
      kind: habit.kind,
      daysDoneLast7d: habit.daysDoneLast7d,
      todayDone: habit.todayDone,
      todayTarget: habit.todayTarget,
    })),
    milestoneDone: milestone.done,
    milestoneTotal: milestone.total,
    currentHeadline: outcome.agentHeadline,
    currentSuggestion: outcome.agentSuggestion,
    unlinkedHabits: unlinkedHabits.map((habit) => ({
      id: habit.id,
      name: habit.name,
      kind: habit.kind,
      daysDoneLast7d: habit.daysDoneLast7d,
      todayDone: habit.todayDone,
      todayTarget: habit.todayTarget,
    })),
  });

  const result = await runWithCritic<SubmitHeadlineArgs>({
    user,
    job,
    capability: 'agent.headline',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    makeTool: submitHeadlineTool,
  });
  if (!result) {
    // Degrade: rule layer stays authoritative; clear the pending pulse.
    await withAgentJobEffects(job, async (tx) => {
      await tx.update(outcomes).set({ agentState: 'idle' }).where(and(eq(outcomes.userId, user.id), eq(outcomes.id, outcomeId), eq(outcomes.agentState, 'pending')));
    });
    return 'skipped:no-llm';
  }

  const headline = withMilestoneHeadline(result.args.headline, milestone.done, milestone.total);
  const suggestion = result.args.suggestion.trim().slice(0, 1000);
  const attachIds = [...new Set(result.args.attachHabitIds ?? [])];
  const attachable = new Set(unlinkedHabits.map((habit) => habit.id));
  await withAgentJobEffects(job, async (tx) => {
    const [current] = await tx.select().from(outcomes).where(and(eq(outcomes.userId, user.id), eq(outcomes.id, outcomeId), eq(outcomes.status, 'open'))).for('update');
    if (!current) { skipExecution('OUTCOME_CHANGED'); return; }
    const plan = planWordingUpdate({
      threadName: current.name,
      currentHeadline: current.agentHeadline,
      currentSuggestion: current.agentSuggestion,
      ruleNextStep: current.ruleNextStep,
      nextHeadline: headline,
      nextSuggestion: suggestion,
      milestoneTotal: milestone.total,
    });
    await tx
      .update(outcomes)
      .set({
        ...(plan.headline !== null ? { agentHeadline: plan.headline === '' ? null : plan.headline } : {}),
        ...(plan.suggestion !== null ? { agentSuggestion: plan.suggestion === '' ? null : plan.suggestion } : {}),
        agentState: 'idle',
        agentUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(outcomes.id, outcomeId), eq(outcomes.userId, user.id)));
    if (plan.proposeHeadline && plan.headline) {
      const headlineId = randomUUID();
      await recordAgentAction(tx, {
        id: headlineId,
        userId: user.id,
        jobId: job.id,
        actionType: 'outcome.headline',
        targetType: 'outcome',
        targetId: outcomeId,
        payload: { headline: plan.headline, previousHeadline: current.agentHeadline },
        feedback: 'pending',
      });
      await retireOlderPending(tx, user.id, outcomeId, 'outcome.headline', headlineId, now);
    }
    if (plan.proposeSuggestion && plan.suggestion) {
      const suggestionId = randomUUID();
      await recordAgentAction(tx, {
        id: suggestionId,
        userId: user.id,
        jobId: job.id,
        actionType: 'outcome.suggestion',
        targetType: 'outcome',
        targetId: outcomeId,
        payload: { suggestion: plan.suggestion, previousSuggestion: current.agentSuggestion },
        feedback: 'pending',
      });
      await retireOlderPending(tx, user.id, outcomeId, 'outcome.suggestion', suggestionId, now);
    }
    let attached = 0;
    for (const habitId of attachIds) {
      if (!attachable.has(habitId)) continue;
      const [habit] = await tx
        .select({ id: habits.id, name: habits.name, outcomeId: habits.outcomeId })
        .from(habits)
        .where(and(eq(habits.id, habitId), eq(habits.userId, user.id), eq(habits.active, true)))
        .limit(1)
        .for('update');
      if (!habit || habit.outcomeId !== null) continue;
      await tx
        .update(habits)
        .set({ outcomeId, updatedAt: now })
        .where(and(eq(habits.id, habit.id), eq(habits.userId, user.id), isNull(habits.outcomeId)));
      attached += 1;
      await recordAgentAction(tx, {
        id: randomUUID(),
        userId: user.id,
        jobId: job.id,
        actionType: 'habit.adjust',
        targetType: 'habit',
        targetId: habit.id,
        payload: { outcomeId, outcomeName: current.name, name: habit.name },
        feedback: 'pending',
      });
    }
    if (!plan.proposeHeadline && !plan.proposeSuggestion && attached === 0) skipExecution('NO_CHANGES');
  });
  return 'done';
}
