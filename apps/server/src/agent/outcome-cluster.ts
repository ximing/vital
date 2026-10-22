import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { outcomes, tasks, type AgentJobRow, type TaskRow, type User } from '../db/schema.js';
import { getRetrievalClients } from '../retrieval/registry.js';
import { groupTasksBySimilarity, searchSimilarTasks, TASKS_COLLECTION } from '../retrieval/tasks.js';
import { recordAgentAction } from './action-ledger.js';
import { resolveClusterTarget } from './cluster.js';
import { executionResult, skipExecution } from './executions.service.js';
import { loadAgentMemory, runWithCritic } from './harness.js';
import { enqueueOutcomeRefresh } from './jobs.js';
import { withAgentJobEffects } from './job-runtime.js';
import { finishUnchangedSchedule, iso } from './processor-shared.js';
import type { AgentJobResult } from './processors.js';
import { buildClusterPrompt, type SimilarTaskExample } from './prompts.js';
import { finishAgentSchedule } from './scheduling.js';
import { proposeThreadsTool, type ProposeThreadsArgs } from './tools.js';

/**
 * Vector pre-grouping hint for outcome.cluster: scroll this user's task
 * vectors, keep the unassigned ones (cluster only ever groups unassigned
 * tasks — the payload's outcomeId is null for them, so filtering happens
 * in-process), and greedily group by cosine similarity. The LLM still owns
 * naming and the final grouping. Any failure degrades to no hint.
 */
async function suggestClusterGroups(
  userId: string,
  unassigned: { id: string; title: string }[],
): Promise<string[][] | undefined> {
  try {
    const { qdrant } = getRetrievalClients();
    if (!qdrant) return undefined;
    const points = await qdrant.scrollPoints(
      TASKS_COLLECTION,
      { must: [{ key: 'userId', match: { value: userId } }] },
      { withVector: true },
    );
    const vectorById = new Map<string, number[]>();
    for (const point of points) {
      if (point.vector) vectorById.set(String(point.id), point.vector);
    }
    const ordered = unassigned.flatMap((task) => {
      const vector = vectorById.get(task.id);
      return vector ? [{ id: task.id, vector }] : [];
    });
    if (ordered.length < 2) return undefined;
    const titleById = new Map(unassigned.map((task) => [task.id, task.title]));
    const groups = groupTasksBySimilarity(ordered)
      .filter((ids) => ids.length >= 2)
      .map((ids) => ids.map((id) => titleById.get(id) ?? id));
    return groups.length > 0 ? groups : undefined;
  } catch (err) {
    console.error('[retrieval] cluster pre-grouping failed', err);
    return undefined;
  }
}

/**
 * Similar completed tasks (plus their subtask structure) as reference
 * examples for decompose/draft prompts. Any failure degrades to no examples.
 */
export async function findSimilarTaskExamples(
  userId: string,
  task: TaskRow,
): Promise<SimilarTaskExample[] | undefined> {
  try {
    const similar = await searchSimilarTasks({
      userId,
      query: task.title,
      excludeId: task.id,
      status: 'done',
      limit: 5,
    });
    if (!similar || similar.length === 0) return undefined;
    const db = getDb();
    const children = await db
      .select({ parentId: tasks.parentId, title: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          inArray(
            tasks.parentId,
            similar.map((hit) => hit.id),
          ),
          isNull(tasks.deletedAt),
        ),
      );
    return similar.map((hit) => ({
      title: hit.title,
      subtasks: children.filter((child) => child.parentId === hit.id).map((child) => child.title),
    }));
  } catch (err) {
    console.error('[retrieval] similar task search failed', err);
    return undefined;
  }
}

export async function processOutcomeCluster(
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
        isNull(tasks.calendarKey),
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
    .select({ id: outcomes.id, name: outcomes.name })
    .from(outcomes)
    .where(and(eq(outcomes.userId, user.id), eq(outcomes.status, 'open')));
  const memory = await loadAgentMemory(user.id, 'cluster');
  const suggestedGroups = await suggestClusterGroups(user.id, unassigned);
  const prompt = buildClusterPrompt({
    existing,
    unassignedTasks: unassigned.map((t) => ({ id: t.id, title: t.title, dueAt: iso(t.dueAt) })),
    memory: memory.map((m) => m.content),
    ...(suggestedGroups ? { suggestedGroups } : {}),
  });

  const result = await runWithCritic<ProposeThreadsArgs>({
    user,
    job,
    capability: 'agent.cluster',
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
      outcomeId: t.outcomeId,
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
    const known = existing.map((row) => ({ id: row.id, name: row.name }));
    for (const thread of threads) {
      const currentTasks = await tx.select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt }).from(tasks).where(and(eq(tasks.userId, user.id), inArray(tasks.id, thread.taskIds), isNull(tasks.outcomeId), isNull(tasks.deletedAt), isNull(tasks.habitId), isNull(tasks.calendarKey), inArray(tasks.status, ['todo', 'doing']))).orderBy(asc(tasks.id)).for('update');
      const eligible = currentTasks.filter(task => {
        const snapshot = unassigned.find(source => source.id === task.id);
        return snapshot?.title === task.title && iso(snapshot.dueAt) === iso(task.dueAt);
      });
      if (eligible.length < 2) continue;
      const taskIds = eligible.map(t => t.id);
      const resolved = resolveClusterTarget(thread, known);
      const [liveTarget] =
        resolved.kind === 'attach'
          ? await tx
              .select({ id: outcomes.id })
              .from(outcomes)
              .where(
                and(
                  eq(outcomes.id, resolved.outcomeId),
                  eq(outcomes.userId, user.id),
                  eq(outcomes.status, 'open'),
                ),
              )
              .limit(1)
          : [];
      if (liveTarget) {
        const linked = await tx
          .update(tasks)
          .set({ outcomeId: liveTarget.id, updatedAt: now })
          .where(
            and(
              eq(tasks.userId, user.id),
              inArray(tasks.id, taskIds),
              isNull(tasks.outcomeId),
              isNull(tasks.deletedAt),
              isNull(tasks.habitId),
              isNull(tasks.calendarKey),
              inArray(tasks.status, ['todo', 'doing']),
            ),
          )
          .returning({ id: tasks.id });
        if (linked.length > 0) {
          await enqueueOutcomeRefresh(tx, user.id, liveTarget.id, now);
          attached += linked.length;
        }
        continue;
      }
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
            isNull(tasks.calendarKey),
            inArray(tasks.status, ['todo', 'doing']),
          ),
        );
      known.push({ id: outcomeId, name: thread.name });
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
    if (created === 0 && attached === 0) skipExecution('NO_ELIGIBLE_TASKS');
    executionResult({ resultSummary: `创建 ${String(created)} 个线程，挂载 ${String(attached)} 项任务` });
    if ('scheduleGeneration' in job.payload && typeof job.payload.scheduleGeneration === 'number') await finishAgentSchedule(tx, user.id, 'outcome.cluster', job.payload.scheduleGeneration, now);
  });
  return 'done';
}
