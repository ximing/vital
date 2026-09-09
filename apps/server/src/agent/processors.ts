import { randomUUID } from 'node:crypto';
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
  buildHeadlinePrompt,
  type DistillActionFact,
} from './prompts.js';
import { loadAgentMemory, runProposalPass, runWithCritic } from './harness.js';
import { enqueueAgentJob, enqueueOutcomeRefresh } from './jobs.js';
import {
  proposeSubtasksTool,
  proposeThreadsTool,
  submitHeadlineTool,
  submitMemoriesTool,
  type ProposeSubtasksArgs,
  type ProposeThreadsArgs,
  type SubmitHeadlineArgs,
  type SubmitMemoriesArgs,
} from './tools.js';
import { recordUsage } from './usage.service.js';

export type AgentJobResult = 'done' | 'skipped:no-llm';

/** Outcomes whose agent fields are older than this get re-run by reflect.daily. */
const REFRESH_STALE_MS = 24 * 3600 * 1000;
const DISTILL_WINDOW_DAYS = 30;
const DISTILL_MIN_ACTIONS = 3;
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
  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.id, outcomeId)).limit(1);
  if (!outcome || outcome.userId !== user.id) return 'done';

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
    await db
      .update(outcomes)
      .set({ agentState: 'idle' })
      .where(and(eq(outcomes.id, outcomeId), eq(outcomes.agentState, 'pending')));
    return 'skipped:no-llm';
  }

  const headline = result.args.headline.trim().slice(0, 500);
  const suggestion = result.args.suggestion.trim().slice(0, 1000);
  await db.transaction(async (tx) => {
    await tx
      .update(outcomes)
      .set({
        agentHeadline: headline,
        agentSuggestion: suggestion === '' ? null : suggestion,
        agentState: 'idle',
        agentUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(outcomes.id, outcomeId));
    await tx.insert(agentActions).values({
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
      await tx.insert(agentActions).values({
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
  if (unassigned.length < config.AGENT_CLUSTER_MIN_UNASSIGNED) return 'done';

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
  if (threads.length === 0) return 'done';

  const undoUntil = new Date(now.getTime() + config.AGENT_UNDO_WINDOW_HOURS * 3600 * 1000);
  await db.transaction(async (tx) => {
    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${outcomes.sortOrder}), -1)` })
      .from(outcomes)
      .where(eq(outcomes.userId, user.id));
    let sortOrder = (maxRow?.max ?? -1) + 1;
    for (const thread of threads) {
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
            inArray(tasks.id, thread.taskIds),
            isNull(tasks.outcomeId),
          ),
        );
      await tx.insert(agentActions).values({
        id: randomUUID(),
        userId: user.id,
        jobId: job.id,
        actionType: 'outcome.create',
        targetType: 'outcome',
        targetId: outcomeId,
        payload: { name: thread.name, taskIds: thread.taskIds, headline: thread.headline },
        feedback: 'pending',
      });
    }
  });
  return 'done';
}

async function processTaskDecompose(
  job: AgentJobRow,
  user: User,
  _now: Date,
): Promise<AgentJobResult> {
  if (!('taskId' in job.payload)) return 'done';
  const taskId = job.payload.taskId;
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || task.userId !== user.id || task.deletedAt) return 'done';
  if (task.status === 'done' || task.status === 'canceled') return 'done';
  if (!needsDecomposition(task.deferCount)) return 'done';

  const pending = await db
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.targetType, 'task'),
        eq(agentActions.targetId, taskId),
        eq(agentActions.actionType, 'task.decompose'),
        eq(agentActions.feedback, 'pending'),
      ),
    )
    .limit(1);
  if (pending.length > 0) return 'done';

  const subtasks = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.parentId, taskId), isNull(tasks.deletedAt)));
  const memory = await loadAgentMemory(user.id, 'decompose');
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
  await db.insert(agentActions).values({
    id: randomUUID(),
    userId: user.id,
    jobId: job.id,
    actionType: 'task.decompose',
    targetType: 'task',
    targetId: taskId,
    payload: { subtasks: proposed, deferCount: task.deferCount },
    feedback: 'pending',
  });
  return 'done';
}

/** Rule-only: fan out refreshes for stale threads + cluster when the pile is big. */
async function processReflectDaily(
  job: AgentJobRow,
  user: User,
  now: Date,
): Promise<AgentJobResult> {
  const db = getDb();
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

  const [unassigned] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['todo', 'doing']),
        isNull(tasks.outcomeId),
        isNull(tasks.habitId),
      ),
    );
  if ((unassigned?.n ?? 0) >= config.AGENT_CLUSTER_MIN_UNASSIGNED) {
    const date = 'date' in job.payload ? job.payload.date : now.toISOString().slice(0, 10);
    await enqueueAgentJob(db, {
      userId: user.id,
      jobType: 'outcome.cluster',
      payload: { date },
      dedupKey: `outcome.cluster:${user.id}`,
      scheduledAt: now,
    });
  }
  return 'done';
}

async function processMemoryDistill(
  job: AgentJobRow,
  user: User,
  now: Date,
): Promise<AgentJobResult> {
  const db = getDb();
  const since = new Date(now.getTime() - DISTILL_WINDOW_DAYS * 24 * 3600 * 1000);
  const recent = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.userId, user.id),
        inArray(agentActions.feedback, ['accepted', 'edited', 'dismissed']),
        gte(agentActions.createdAt, since),
      ),
    )
    .orderBy(desc(agentActions.createdAt))
    .limit(50);
  if (recent.length < DISTILL_MIN_ACTIONS) return 'done';

  // Governance reads the FULL memory list (no scope filter) so the model can
  // decide merges/evictions across everything the user has accumulated.
  const existing = await db
    .select({
      id: agentMemory.id,
      kind: agentMemory.kind,
      content: agentMemory.content,
      manual: agentMemory.manual,
      scope: agentMemory.scope,
    })
    .from(agentMemory)
    .where(eq(agentMemory.userId, user.id))
    .orderBy(desc(agentMemory.createdAt));
  const facts: DistillActionFact[] = recent.map((a) => ({
    actionType: a.actionType,
    feedback: a.feedback,
    summary: JSON.stringify(a.payload).slice(0, 200),
    editedSummary: a.feedbackPayload ? JSON.stringify(a.feedbackPayload).slice(0, 200) : null,
  }));
  const prompt = buildDistillPrompt({ actions: facts, existingMemory: existing });

  const result = await runProposalPass<SubmitMemoriesArgs>({
    user,
    capability: 'agent.distill',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    makeTool: submitMemoriesTool,
  });
  if (!result) return 'skipped:no-llm';
  await recordUsage(db, {
    userId: user.id,
    jobId: job.id,
    capability: 'distill',
    model: result.model,
    usage: result.usage,
  });

  const updates = (result.args.update ?? [])
    .map((u) => ({ id: u.id, content: u.content.trim(), scope: sanitizeScope(u.scope) }))
    .filter((u) => u.content !== '');
  const adds = (result.args.add ?? [])
    .map((a) => ({ kind: a.kind, content: a.content.trim(), scope: sanitizeScope(a.scope) }))
    .filter((a) => a.content !== '')
    .slice(0, 5);
  const drops = [...new Set(result.args.drop ?? [])];
  if (updates.length === 0 && adds.length === 0 && drops.length === 0) return 'done';

  await db.transaction(async (tx) => {
    for (const u of updates) {
      // Ownership + manual guard: model may only touch its own non-manual rows.
      await tx
        .update(agentMemory)
        .set({
          content: u.content,
          ...(u.scope ? { scope: u.scope } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(agentMemory.id, u.id),
            eq(agentMemory.userId, user.id),
            eq(agentMemory.manual, false),
          ),
        );
    }
    if (drops.length > 0) {
      await tx
        .delete(agentMemory)
        .where(
          and(
            inArray(agentMemory.id, drops),
            eq(agentMemory.userId, user.id),
            eq(agentMemory.manual, false),
          ),
        );
    }
    for (const a of adds) {
      await tx.insert(agentMemory).values({
        id: randomUUID(),
        userId: user.id,
        kind: a.kind,
        content: a.content,
        sourceCount: recent.length,
        scope: a.scope ?? ['all'],
        createdAt: now,
        updatedAt: now,
      });
    }

    // Cap: evict oldest non-manual rows until the total fits the budget.
    const [total] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(agentMemory)
      .where(eq(agentMemory.userId, user.id));
    let over = (total?.n ?? 0) - MEMORY_TOTAL_LIMIT;
    if (over > 0) {
      const oldest = await tx
        .select({ id: agentMemory.id, manual: agentMemory.manual })
        .from(agentMemory)
        .where(eq(agentMemory.userId, user.id))
        .orderBy(asc(agentMemory.createdAt), asc(agentMemory.id));
      const evict: string[] = [];
      for (const row of oldest) {
        if (over <= 0) break;
        if (row.manual) continue;
        evict.push(row.id);
        over -= 1;
      }
      if (evict.length > 0) {
        await tx.delete(agentMemory).where(inArray(agentMemory.id, evict));
      }
    }
  });
  return 'done';
}

export async function processAgentJob(job: AgentJobRow, now: Date): Promise<AgentJobResult> {
  const [user] = await getDb().select().from(users).where(eq(users.id, job.userId)).limit(1);
  if (!user) return 'done';
  switch (job.jobType) {
    case 'outcome.refresh':
      return processOutcomeRefresh(job, user, now);
    case 'outcome.cluster':
      return processOutcomeCluster(job, user, now);
    case 'task.decompose':
      return processTaskDecompose(job, user, now);
    case 'reflect.daily':
      return processReflectDaily(job, user, now);
    case 'memory.distill':
      return processMemoryDistill(job, user, now);
    default:
      return 'done';
  }
}
