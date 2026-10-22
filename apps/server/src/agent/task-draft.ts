import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { agentActions, outcomes, tasks, type AgentJobRow, type User } from '../db/schema.js';
import { recordAgentAction } from './action-ledger.js';
import { executionResult, skipExecution } from './executions.service.js';
import { loadAgentMemory, runWithCritic } from './harness.js';
import { withAgentJobEffects } from './job-runtime.js';
import { findSimilarTaskExamples } from './outcome-cluster.js';
import { iso } from './processor-shared.js';
import type { AgentJobResult } from './processors.js';
import { buildDraftPrompt } from './prompts.js';
import { submitDraftTool, type SubmitDraftArgs } from './tools.js';

/**
 * Manual trigger: draft an execution plan for a delegable task. The proposal
 * lands in the agent_actions ledger; the web 方案卡 applies it into the task
 * notes (and any proposed subtasks) on accept. Idempotent — a pending draft
 * suppresses re-generation.
 */
export async function processTaskDraft(
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
  const memory = await loadAgentMemory(user.id, 'draft', task.title);
  const similarExamples = await findSimilarTaskExamples(user.id, task);
  executionResult({ inputSummary: `仅当前用户：当前任务、${String(subtasks.length)} 项子任务、${String(memory.length)} 条记忆` });
  const prompt = buildDraftPrompt({
    taskTitle: task.title,
    notes: task.notesMd,
    outcomeName,
    dueAt: iso(task.dueAt),
    estimateMinutes: task.estimateMinutes,
    existingSubtasks: subtasks.map((s) => s.title),
    memory: memory.map((m) => m.content),
    canSplit: task.parentId === null,
    ...(similarExamples ? { similarExamples } : {}),
  });

  const result = await runWithCritic<SubmitDraftArgs>({
    user,
    job,
    capability: 'agent.draft',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    makeTool: submitDraftTool,
  });
  if (!result) return 'skipped:no-llm';

  const draft = result.args.draft.trim().slice(0, 2000);
  const proposed = (result.args.subtasks ?? [])
    .map((item) => ({
      title: item.title.trim().slice(0, 500),
      estimateMinutes: item.estimateMinutes ?? null,
    }))
    .filter((item) => item.title !== '');
  if (draft === '' && proposed.length === 0) return 'done';

  await withAgentJobEffects(job, async (tx) => {
    const [current] = await tx.select().from(tasks).where(and(eq(tasks.userId, user.id), eq(tasks.id, taskId), isNull(tasks.deletedAt), inArray(tasks.status, ['todo', 'doing']))).for('update');
    if (!current || !current.delegable) { skipExecution('TASK_CHANGED'); return; }
    const pending = await tx.select({ id: agentActions.id }).from(agentActions).where(and(eq(agentActions.userId, user.id), eq(agentActions.targetId, taskId), eq(agentActions.targetType, 'task'), eq(agentActions.actionType, 'task.draft'), eq(agentActions.feedback, 'pending'))).limit(1);
    if (pending.length) { skipExecution('ALREADY_PENDING'); return; }
    const subtasksPayload = current.parentId === null ? proposed : [];
    await recordAgentAction(tx, {
      id: randomUUID(),
      userId: user.id,
      jobId: job.id,
      actionType: 'task.draft',
      targetType: 'task',
      targetId: taskId,
      payload: {
        ...(draft !== '' ? { draft } : {}),
        ...(subtasksPayload.length > 0 ? { subtasks: subtasksPayload } : {}),
      },
      feedback: 'pending',
    });
    executionResult({ resultSummary: '新增 1 项提案' });
  });
  return 'done';
}
