import { finishAgentSchedule } from './scheduling.js';
import { RetryableAgentJobError, withAgentJobEffects } from './job-runtime.js';
import { agentMemoryFeedback, agentMemoryHistory, agentMemoryMaintenance } from '../db/schema/agent-memory-history.js';
import { recordAgentAction } from './action-ledger.js';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import {
  AGENT_MEMORY_SCOPES,
  agentActions,
  agentMemory,
  outcomes,
  taskCompletions,
  tasks,
  users,
  type AgentJobRow,
  type AgentMemoryScope,
  type User,
} from '../db/schema.js';
import { isOverdue, needsDecomposition } from '../outcomes/rule-engine.js';
import {
  buildClusterPrompt,
  buildDecomposePrompt,
  buildDistillPrompt,
  buildDraftPrompt,
  buildHeadlinePrompt,
  type DistillActionFact,
} from './prompts.js';
import { loadAgentMemory, runProposalPass, runWithCritic } from './harness.js';
import { enqueueOutcomeRefresh, UnknownAgentJobTypeError } from './jobs.js';
import {
  proposeSubtasksTool,
  proposeThreadsTool,
  submitHeadlineTool,
  submitMemoriesTool,
  type ProposeSubtasksArgs,
  type ProposeThreadsArgs,
  type SubmitHeadlineArgs,
  type SubmitMemoriesArgs,
  submitNotificationTool,
  type SubmitNotificationArgs,
  submitDraftTool,
  type SubmitDraftArgs,
} from './tools.js';
import { executionResult, skipExecution, withExecution } from './executions.service.js';
import { enqueueProactiveInsights } from '../notifications/insights.js';

export type AgentJobResult = 'done' | 'skipped:no-llm';

/** Outcomes whose agent fields are older than this get re-run by reflect.daily. */
const REFRESH_STALE_MS = 24 * 3600 * 1000;
/** Governance budget: distill evicts oldest non-manual rows beyond this total. */
const MEMORY_TOTAL_LIMIT = 30;

/** Model-provided scope lists are untrusted: keep known values only. */
function sanitizeScope(scope: string[] | undefined): AgentMemoryScope[] | null {
  if (!scope) return null;
  const valid = [...new Set(scope)].filter((s): s is AgentMemoryScope =>
    (AGENT_MEMORY_SCOPES as readonly string[]).includes(s),
  );
  return valid.length > 0 ? valid : null;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

async function processOutcomeRefresh(
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
        gte(taskCompletions.completedAt, weekAgo),
      ),
    );

  const memory = await loadAgentMemory(user.id, 'headline');
  executionResult({ inputSummary: `仅当前用户：线程内 ${String(openTasks.length)} 项未完成任务，${String(memory.length)} 条记忆` });
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
  });

  const result = await runWithCritic<SubmitHeadlineArgs>({
    user,
    job,
    capability: 'agent.headline',
    usageCapability: 'headline',
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

  const headline = result.args.headline.trim().slice(0, 500);
  const suggestion = result.args.suggestion.trim().slice(0, 1000);
  await withAgentJobEffects(job, async (tx) => {
    const [current] = await tx.select().from(outcomes).where(and(eq(outcomes.userId, user.id), eq(outcomes.id, outcomeId), eq(outcomes.status, 'open'))).for('update');
    if (!current) { skipExecution('OUTCOME_CHANGED'); return; }
    await tx
      .update(outcomes)
      .set({
        agentHeadline: headline,
        agentSuggestion: suggestion === '' ? null : suggestion,
        agentState: 'idle',
        agentUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(outcomes.id, outcomeId), eq(outcomes.userId, user.id)));
    await recordAgentAction(tx, {
      id: randomUUID(),
      userId: user.id,
      jobId: job.id,
      actionType: 'outcome.headline',
      targetType: 'outcome',
      targetId: outcomeId,
      payload: { headline },
      feedback: 'pending',
    });
    if (suggestion !== '') {
      await recordAgentAction(tx, {
        id: randomUUID(),
        userId: user.id,
        jobId: job.id,
        actionType: 'outcome.suggestion',
        targetType: 'outcome',
        targetId: outcomeId,
        payload: { suggestion },
        feedback: 'pending',
      });
    }
  });
  return 'done';
}

async function processOutcomeCluster(
  job: AgentJobRow,
  user: User,
  now: Date,
): Promise<AgentJobResult> {
  const db = getDb();
  const unassigned = await db
    .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['todo', 'doing']),
        isNull(tasks.outcomeId),
        isNull(tasks.habitId),
      ),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(50);
  if (unassigned.length < config.AGENT_CLUSTER_MIN_UNASSIGNED) {
    skipExecution('INSUFFICIENT_TASKS');
    await finishUnchangedSchedule(job, user.id, 'outcome.cluster', now);
    return 'done';
  }

  executionResult({ inputSummary: `仅当前用户：${String(unassigned.length)} 项未归属任务` });
  const existing = await db
    .select({ name: outcomes.name })
    .from(outcomes)
    .where(and(eq(outcomes.userId, user.id), eq(outcomes.status, 'open')));
  const memory = await loadAgentMemory(user.id, 'cluster');
  const prompt = buildClusterPrompt({
    existingNames: existing.map((o) => o.name),
    unassignedTasks: unassigned.map((t) => ({ id: t.id, title: t.title, dueAt: iso(t.dueAt) })),
    memory: memory.map((m) => m.content),
  });

  const result = await runWithCritic<ProposeThreadsArgs>({
    user,
    job,
    capability: 'agent.cluster',
    usageCapability: 'cluster',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    makeTool: proposeThreadsTool,
  });
  if (!result) return 'skipped:no-llm';

  // Keep only still-unassigned task ids, at most one thread per task, ≥2 tasks.
  const valid = new Set(unassigned.map((t) => t.id));
  const used = new Set<string>();
  const threads = result.args.threads
    .map((t) => ({
      name: t.name.trim().slice(0, 120),
      headline: t.headline.trim().slice(0, 500),
      taskIds: [...new Set(t.taskIds)].filter((id) => {
        if (!valid.has(id) || used.has(id)) return false;
        used.add(id);
        return true;
      }),
    }))
    .filter((t) => t.name !== '' && t.taskIds.length >= 2)
    .slice(0, 3);
  if (threads.length === 0) { skipExecution('NO_CHANGES'); await finishUnchangedSchedule(job, user.id, 'outcome.cluster', now); return 'done'; }

  const undoUntil = new Date(now.getTime() + config.AGENT_UNDO_WINDOW_HOURS * 3600 * 1000);
  await withAgentJobEffects(job, async (tx) => {
    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${outcomes.sortOrder}), -1)` })
      .from(outcomes)
      .where(eq(outcomes.userId, user.id));
    let sortOrder = (maxRow?.max ?? -1) + 1;
    let created = 0;
    let attached = 0;
    for (const thread of threads) {
      const currentTasks = await tx.select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt }).from(tasks).where(and(eq(tasks.userId, user.id), inArray(tasks.id, thread.taskIds), isNull(tasks.outcomeId), isNull(tasks.deletedAt), isNull(tasks.habitId), inArray(tasks.status, ['todo', 'doing']))).orderBy(asc(tasks.id)).for('update');
      const eligible = currentTasks.filter(task => {
        const snapshot = unassigned.find(source => source.id === task.id);
        return snapshot?.title === task.title && iso(snapshot.dueAt) === iso(task.dueAt);
      });
      if (eligible.length < 2) continue;
      const taskIds = eligible.map(t => t.id);
      const outcomeId = randomUUID();
      await tx.insert(outcomes).values({
        id: outcomeId,
        userId: user.id,
        name: thread.name,
        createdBy: 'agent',
        undoUntil,
        agentHeadline: thread.headline === '' ? null : thread.headline,
        agentState: 'idle',
        agentUpdatedAt: now,
        sortOrder: sortOrder++,
        createdAt: now,
        updatedAt: now,
      });
      // Race guard: only attach tasks still unassigned inside the transaction.
      await tx
        .update(tasks)
        .set({ outcomeId, updatedAt: now })
        .where(
          and(
            eq(tasks.userId, user.id),
            inArray(tasks.id, taskIds),
            isNull(tasks.outcomeId),
            isNull(tasks.deletedAt),
            isNull(tasks.habitId),
            inArray(tasks.status, ['todo', 'doing']),
          ),
        );
      await recordAgentAction(tx, {
        id: randomUUID(),
        userId: user.id,
        jobId: job.id,
        actionType: 'outcome.create',
        targetType: 'outcome',
        targetId: outcomeId,
        payload: { name: thread.name, taskIds, headline: thread.headline },
        feedback: 'pending',
      });
      created += 1;
      attached += taskIds.length;
    }
    if (created === 0) skipExecution('NO_ELIGIBLE_TASKS');
    executionResult({ resultSummary: `创建 ${String(created)} 个线程，挂载 ${String(attached)} 项任务` });
    if ('scheduleGeneration' in job.payload && typeof job.payload.scheduleGeneration === 'number') await finishAgentSchedule(tx, user.id, 'outcome.cluster', job.payload.scheduleGeneration, now);
  });
  return 'done';
}

async function processTaskDecompose(
  job: AgentJobRow,
  user: User,
  _now: Date,
): Promise<AgentJobResult> {
  if (!('taskId' in job.payload)) { skipExecution('INVALID_PAYLOAD'); return 'done'; }
  const taskId = job.payload.taskId;
  const db = getDb();
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, user.id))).limit(1);
  if (!task || task.userId !== user.id || task.deletedAt) { skipExecution('TASK_NOT_FOUND'); return 'done'; }
  if (task.status === 'done' || task.status === 'canceled') { skipExecution('TASK_CLOSED'); return 'done'; }
  if (!needsDecomposition(task.deferCount)) { skipExecution('NOT_ELIGIBLE'); return 'done'; }

  const pending = await db
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.userId, user.id),
        eq(agentActions.targetType, 'task'),
        eq(agentActions.targetId, taskId),
        eq(agentActions.actionType, 'task.decompose'),
        eq(agentActions.feedback, 'pending'),
      ),
    )
    .limit(1);
  if (pending.length > 0) { skipExecution('ALREADY_PENDING'); return 'done'; }

  const subtasks = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), eq(tasks.parentId, taskId), isNull(tasks.deletedAt)));
  const memory = await loadAgentMemory(user.id, 'decompose');
  executionResult({ inputSummary: `仅当前用户：当前任务、${String(subtasks.length)} 项子任务、${String(memory.length)} 条记忆` });
  const prompt = buildDecomposePrompt({
    taskTitle: task.title,
    notes: task.notesMd,
    deferCount: task.deferCount,
    estimateMinutes: task.estimateMinutes,
    existingSubtasks: subtasks.map((s) => s.title),
    memory: memory.map((m) => m.content),
  });

  const result = await runWithCritic<ProposeSubtasksArgs>({
    user,
    job,
    capability: 'agent.decompose',
    usageCapability: 'decompose',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    makeTool: proposeSubtasksTool,
  });
  if (!result) return 'skipped:no-llm';

  const proposed = result.args.subtasks
    .map((s) => ({
      title: s.title.trim().slice(0, 500),
      estimateMinutes: s.estimateMinutes ?? null,
    }))
    .filter((s) => s.title !== '')
    .slice(0, 10);
  if (proposed.length === 0) return 'done';

  // v1: proposal only — the web DecomposeBanner creates the subtasks on accept.
  await withAgentJobEffects(job, async (tx) => {
    const [current] = await tx.select().from(tasks).where(and(eq(tasks.userId, user.id), eq(tasks.id, taskId), isNull(tasks.deletedAt), inArray(tasks.status, ['todo', 'doing']))).for('update');
    if (!current || !needsDecomposition(current.deferCount)) { skipExecution('TASK_CHANGED'); return; }
    const pending = await tx.select({ id: agentActions.id }).from(agentActions).where(and(eq(agentActions.userId, user.id), eq(agentActions.targetId, taskId), eq(agentActions.targetType, 'task'), eq(agentActions.actionType, 'task.decompose'), eq(agentActions.feedback, 'pending'))).limit(1);
    if (pending.length) { skipExecution('ALREADY_PENDING'); return; }
  await recordAgentAction(tx, {
    id: randomUUID(),
    userId: user.id,
    jobId: job.id,
    actionType: 'task.decompose',
    targetType: 'task',
    targetId: taskId,
    payload: { subtasks: proposed, deferCount: task.deferCount },
    feedback: 'pending',
  });
    executionResult({ resultSummary: '新增 1 项提案' });
  });
  return 'done';
}

/**
 * Manual trigger: draft an execution plan for a delegable task. The proposal
 * lands in the agent_actions ledger; the web 方案卡 applies it into the task
 * notes on accept. Idempotent — a pending draft suppresses re-generation.
 */
async function processTaskDraft(
  job: AgentJobRow,
  user: User,
  _now: Date,
): Promise<AgentJobResult> {
  if (!('taskId' in job.payload)) { skipExecution('INVALID_PAYLOAD'); return 'done'; }
  const taskId = job.payload.taskId;
  const db = getDb();
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, user.id))).limit(1);
  if (!task || task.userId !== user.id || task.deletedAt) { skipExecution('TASK_NOT_FOUND'); return 'done'; }
  if (task.status === 'done' || task.status === 'canceled') { skipExecution('TASK_CLOSED'); return 'done'; }
  if (!task.delegable) { skipExecution('NOT_DELEGABLE'); return 'done'; }

  const pending = await db
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.userId, user.id),
        eq(agentActions.targetType, 'task'),
        eq(agentActions.targetId, taskId),
        eq(agentActions.actionType, 'task.draft'),
        eq(agentActions.feedback, 'pending'),
      ),
    )
    .limit(1);
  if (pending.length > 0) { skipExecution('ALREADY_PENDING'); return 'done'; }

  let outcomeName: string | null = null;
  if (task.outcomeId) {
    const [outcome] = await db
      .select({ name: outcomes.name })
      .from(outcomes)
      .where(and(eq(outcomes.id, task.outcomeId), eq(outcomes.userId, user.id)))
      .limit(1);
    outcomeName = outcome?.name ?? null;
  }
  const subtasks = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), eq(tasks.parentId, taskId), isNull(tasks.deletedAt)));
  const memory = await loadAgentMemory(user.id, 'draft');
  executionResult({ inputSummary: `仅当前用户：当前任务、${String(subtasks.length)} 项子任务、${String(memory.length)} 条记忆` });
  const prompt = buildDraftPrompt({
    taskTitle: task.title,
    notes: task.notesMd,
    outcomeName,
    dueAt: iso(task.dueAt),
    estimateMinutes: task.estimateMinutes,
    existingSubtasks: subtasks.map((s) => s.title),
    memory: memory.map((m) => m.content),
  });

  const result = await runWithCritic<SubmitDraftArgs>({
    user,
    job,
    capability: 'agent.draft',
    usageCapability: 'draft',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    makeTool: submitDraftTool,
  });
  if (!result) return 'skipped:no-llm';

  const draft = result.args.draft.trim().slice(0, 2000);
  if (draft === '') return 'done';

  await withAgentJobEffects(job, async (tx) => {
    const [current] = await tx.select().from(tasks).where(and(eq(tasks.userId, user.id), eq(tasks.id, taskId), isNull(tasks.deletedAt), inArray(tasks.status, ['todo', 'doing']))).for('update');
    if (!current || !current.delegable) { skipExecution('TASK_CHANGED'); return; }
    const pending = await tx.select({ id: agentActions.id }).from(agentActions).where(and(eq(agentActions.userId, user.id), eq(agentActions.targetId, taskId), eq(agentActions.targetType, 'task'), eq(agentActions.actionType, 'task.draft'), eq(agentActions.feedback, 'pending'))).limit(1);
    if (pending.length) { skipExecution('ALREADY_PENDING'); return; }
  await recordAgentAction(tx, {
    id: randomUUID(),
    userId: user.id,
    jobId: job.id,
    actionType: 'task.draft',
    targetType: 'task',
    targetId: taskId,
    payload: { draft },
    feedback: 'pending',
  });
    executionResult({ resultSummary: '新增 1 项提案' });
  });
  return 'done';
}

/** Rule-only: fan out refreshes for stale threads + cluster when the pile is big. */
async function processReflectDaily(
  job: AgentJobRow,
  user: User,
  now: Date,
): Promise<AgentJobResult> {
  await withAgentJobEffects(job, async (db) => {
  const staleBefore = new Date(now.getTime() - REFRESH_STALE_MS);
  const stale = await db
    .select({ id: outcomes.id })
    .from(outcomes)
    .where(
      and(
        eq(outcomes.userId, user.id),
        eq(outcomes.status, 'open'),
        ne(outcomes.agentState, 'pending'),
        or(isNull(outcomes.agentUpdatedAt), lt(outcomes.agentUpdatedAt, staleBefore)),
      ),
    )
    .limit(20);
  for (const row of stale) {
    await enqueueOutcomeRefresh(db, user.id, row.id, now);
  }
  executionResult({ resultSummary: `已安排更新 ${String(stale.length)} 个线程`, inputSummary: '仅检查当前用户的开放线程' });

  });
  return 'done';
}

async function finishUnchangedSchedule(job: AgentJobRow, userId: string, capability: 'outcome.cluster' | 'memory.distill', now: Date): Promise<void> {
  await withAgentJobEffects(job, async tx => {
    if ('scheduleGeneration' in job.payload && typeof job.payload.scheduleGeneration === 'number') await finishAgentSchedule(tx, userId, capability, job.payload.scheduleGeneration, now);
  });
}

function memoryFingerprint(rows: { id: string; kind: string; content: string; scope: string[]; manual: boolean }[]): string {
  return createHash('sha256').update(JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, kind, content, scope, manual }) => ({ id, kind, content, scope, manual })))).digest('hex');
}

async function processMemoryDistill(job: AgentJobRow, user: User, now: Date): Promise<AgentJobResult> {
  const db = getDb();
  const maintenance = 'mode' in job.payload && job.payload.mode === 'maintenance';
  const existing = await db.select().from(agentMemory).where(eq(agentMemory.userId, user.id)).orderBy(desc(agentMemory.createdAt));
  const fingerprint = memoryFingerprint(existing);
  const [lastMaintenance] = await db.select().from(agentMemoryMaintenance).where(eq(agentMemoryMaintenance.userId, user.id));
  if (maintenance && (existing.length === 0 || lastMaintenance?.fingerprint === fingerprint)) {
    skipExecution('UNCHANGED_INPUT'); return 'done';
  }
  // Feedback time, never proposal creation time. The immutable version also
  // catches a later edit to a previously processed feedback row.
  const candidates = maintenance ? [] : await db.select().from(agentActions).where(and(
    eq(agentActions.userId, user.id), inArray(agentActions.feedback, ['accepted', 'edited', 'dismissed']),
    sql`${agentActions.feedbackAt} is not null`,
    ...('scheduleFeedbackThrough' in job.payload && job.payload.scheduleFeedbackThrough ? [sql`${agentActions.feedbackAt} <= ${new Date(job.payload.scheduleFeedbackThrough)}`] : []),
    sql`not exists (select 1 from ${agentMemoryFeedback} p where p.user_id = ${agentActions.userId} and p.action_id = ${agentActions.id} and p.feedback_at = ${agentActions.feedbackAt} and p.version = md5(${agentActions.feedback} || ':' || coalesce(${agentActions.feedbackPayload}::text, 'null') || ':' || ${agentActions.feedbackAt}::text))`,
  )).orderBy(asc(agentActions.feedbackAt), asc(agentActions.id)).limit(50);
  if (!maintenance && candidates.length === 0) { skipExecution('UNCHANGED_INPUT'); await finishUnchangedSchedule(job, user.id, 'memory.distill', now); return 'done'; }
  const recent = candidates;
  executionResult({ inputSummary: `仅当前用户：${String(recent.length)} 条新反馈，${String(existing.length)} 条记忆` });
  const facts: DistillActionFact[] = recent.map(a => ({ actionType: a.actionType, feedback: a.feedback, summary: JSON.stringify(a.payload).slice(0, 200), editedSummary: a.feedbackPayload ? JSON.stringify(a.feedbackPayload).slice(0, 200) : null }));
  const prompt = buildDistillPrompt({ actions: facts, existingMemory: existing, mode: maintenance ? 'maintenance' : 'incremental' });
  const result = await runProposalPass<SubmitMemoriesArgs>({ user, capability: 'agent.distill', systemPrompt: prompt.system, userPrompt: prompt.user, makeTool: submitMemoriesTool });
  if (!result) return 'skipped:no-llm';
  const updates = (result.args.update ?? []).map(u => ({ id: u.id, content: u.content.trim(), scope: sanitizeScope(u.scope) })).filter(u => u.content !== '');
  const adds = (result.args.add ?? []).map(a => ({ kind: a.kind, content: a.content.trim(), scope: sanitizeScope(a.scope) })).filter(a => a.content !== '').slice(0, 5);
  const drops = new Set(result.args.drop ?? []);
  const counts = await withAgentJobEffects(job, async tx => {
    // Serialize governance against other runs and user memory edits; abort stale
    // proposals instead of overwriting changes made during model latency.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('no key update');
    const current = await tx.select().from(agentMemory).where(eq(agentMemory.userId, user.id)).for('update');
    if (memoryFingerprint(current) !== fingerprint) throw new RetryableAgentJobError('Memory changed while distilling');
    const sources: { actionId: string; feedbackAt: string; version: string }[] = [];
    for (const a of recent) {
      if (!a.feedbackAt) throw new RetryableAgentJobError('Feedback timestamp missing');
      const [fresh] = await tx.select({ id: agentActions.id, feedbackAt: agentActions.feedbackAt, version: sql<string>`md5(${agentActions.feedback} || ':' || coalesce(${agentActions.feedbackPayload}::text, 'null') || ':' || ${agentActions.feedbackAt}::text)` }).from(agentActions).where(and(eq(agentActions.userId, user.id), eq(agentActions.id, a.id), eq(agentActions.feedbackAt, a.feedbackAt), eq(agentActions.feedback, a.feedback), sql`${agentActions.feedbackPayload} is not distinct from ${a.feedbackPayload ? JSON.stringify(a.feedbackPayload) : null}::jsonb`)).for('update');
      if (!fresh?.feedbackAt) throw new RetryableAgentJobError('Feedback changed while distilling');
      const inserted = await tx.insert(agentMemoryFeedback).values({ userId: user.id, actionId: fresh.id, feedbackAt: fresh.feedbackAt, version: fresh.version, jobId: job.id, processedAt: now }).onConflictDoNothing().returning();
      if (!inserted.length) throw new RetryableAgentJobError('Feedback already processed by another distill');
      sources.push({ actionId: fresh.id, feedbackAt: fresh.feedbackAt.toISOString(), version: fresh.version });
    }
    const counts = { added: 0, updated: 0, deleted: 0 };
    const history = async (operation: string, before: typeof agentMemory.$inferSelect | null, after: typeof agentMemory.$inferSelect | null) => {
      const row = after ?? before;
      if (!row) return;
      await tx.insert(agentMemoryHistory).values({ id: randomUUID(), userId: user.id, memoryId: row.id, revision: after?.version ?? row.version + 1, operation, before, after, sourceFeedback: sources, jobId: job.id, createdAt: now });
    };
    for (const u of updates) {
      const before = current.find(m => m.id === u.id && !m.manual);
      if (!before || drops.has(u.id)) continue;
      const scope = u.scope ?? before.scope;
      if (before.content === u.content && JSON.stringify(before.scope) === JSON.stringify(scope)) continue;
      const [after] = await tx.update(agentMemory).set({ content: u.content, scope, version: before.version + 1, sourceCount: before.sourceCount + sources.length, updatedAt: now }).where(and(eq(agentMemory.userId, user.id), eq(agentMemory.id, u.id), eq(agentMemory.manual, false))).returning();
      if (after) { counts.updated++; await history('update', before, after); Object.assign(before, after); }
    }
    for (const before of current.filter(m => !m.manual && drops.has(m.id))) {
      const removed = await tx.delete(agentMemory).where(and(eq(agentMemory.userId, user.id), eq(agentMemory.id, before.id), eq(agentMemory.manual, false))).returning();
      if (removed.length) { counts.deleted++; await history('drop', before, null); }
    }
    for (const a of adds) {
      const duplicate = current.some(m => !drops.has(m.id) && m.content === a.content && m.kind === a.kind);
      if (duplicate) continue;
      const [after] = await tx.insert(agentMemory).values({ id: randomUUID(), userId: user.id, kind: a.kind, content: a.content, sourceCount: sources.length, scope: a.scope ?? ['all'], createdAt: now, updatedAt: now }).returning();
      if (after) { counts.added++; await history('add', null, after); current.push(after); }
    }
    const all = await tx.select().from(agentMemory).where(eq(agentMemory.userId, user.id)).orderBy(asc(agentMemory.createdAt), asc(agentMemory.id));
    let over = all.length - MEMORY_TOTAL_LIMIT;
    for (const before of all) {
      if (over <= 0) break;
      if (before.manual) continue;
      const removed = await tx.delete(agentMemory).where(and(eq(agentMemory.userId, user.id), eq(agentMemory.id, before.id), eq(agentMemory.manual, false))).returning();
      if (removed.length) { over--; counts.deleted++; await history('evict', before, null); }
    }
    const final = await tx.select().from(agentMemory).where(eq(agentMemory.userId, user.id));
    if (maintenance) await tx.insert(agentMemoryMaintenance).values({ userId: user.id, fingerprint: memoryFingerprint(final), updatedAt: now }).onConflictDoUpdate({ target: agentMemoryMaintenance.userId, set: { fingerprint: memoryFingerprint(final), updatedAt: now } });
    if (!maintenance && 'scheduleGeneration' in job.payload && typeof job.payload.scheduleGeneration === 'number') await finishAgentSchedule(tx, user.id, 'memory.distill', job.payload.scheduleGeneration, now);
    return counts;
  });
  executionResult({ resultSummary: `记忆整理：新增 ${String(counts.added)}，更新 ${String(counts.updated)}，删除 ${String(counts.deleted)}` });
  if (counts.added + counts.updated + counts.deleted === 0) skipExecution('NO_CHANGES');
  return 'done';
}

export async function processAgentJob(job: AgentJobRow, now: Date): Promise<AgentJobResult> {
  return withExecution({
    userId: job.userId, capability: job.jobType, jobId: job.id, attempt: job.attemptCount + 1,
    ...('taskId' in job.payload ? { targetType: 'task', targetId: job.payload.taskId } : {}),
    ...('outcomeId' in job.payload ? { targetType: 'outcome', targetId: job.payload.outcomeId } : {}),
  }, async () => {
    const result = await processAgentJobInner(job, now);
    if (result === 'skipped:no-llm') skipExecution('NO_MODEL');
    return result;
  });
}

async function processAgentJobInner(job: AgentJobRow, now: Date): Promise<AgentJobResult> {
  const [user] = await getDb().select().from(users).where(eq(users.id, job.userId)).limit(1);
  if (!user) return 'done';
  switch (job.jobType) {
    case 'outcome.refresh':
      return processOutcomeRefresh(job, user, now);
    case 'outcome.cluster':
      return processOutcomeCluster(job, user, now);
    case 'task.decompose':
      return processTaskDecompose(job, user, now);
    case 'task.draft':
      return processTaskDraft(job, user, now);
    case 'reflect.daily':
      return processReflectDaily(job, user, now);
    case 'memory.distill':
      return processMemoryDistill(job, user, now);
    case 'notify.scan': {
      const inserted = await enqueueProactiveInsights(user, now, async (item) => {
        const memory = await loadAgentMemory(user.id, 'notify');
        const result = await runProposalPass<SubmitNotificationArgs>({ user, capability: 'agent.notify', systemPrompt: '你为个人任务系统写一句简短、温和、可行动的手机提醒。不得添加事实。必须调用 submit_notification。', userPrompt: `规则提醒：${item.message}\n长期偏好：${memory.map((m) => m.content).join('；')}`, makeTool: submitNotificationTool });
        if (!result) return null;
        return result.args.message;
      });
      executionResult({ resultSummary: `已安排 ${String(inserted)} 条提醒`, inputSummary: '仅检查当前用户的任务、线程、习惯与复盘' });
      return 'done';
    }
    default:
      // Old worker meeting a newer job type (e.g. task.draft during the v1.3
      // rollout): never swallow it as done — fail loudly so it is visible.
      throw new UnknownAgentJobTypeError(job.jobType);
  }
}
