import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { agentActions, tasks, type AgentJobRow, type User } from '../db/schema.js';
import { needsDecomposition } from '../outcomes/rule-engine.js';
import { recordAgentAction } from './action-ledger.js';
import { executionResult, skipExecution } from './executions.service.js';
import { loadAgentMemory, runWithCritic } from './harness.js';
import { withAgentJobEffects } from './job-runtime.js';
import { findSimilarTaskExamples } from './outcome-cluster.js';
import type { AgentJobResult } from './processors.js';
import { buildDecomposePrompt } from './prompts.js';
import { proposeSubtasksTool, type ProposeSubtasksArgs } from './tools.js';

export async function processTaskDecompose(
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
  const memory = await loadAgentMemory(
    user.id,
    'decompose',
    task.title + (task.notesMd ? '\n' + task.notesMd.slice(0, 200) : ''),
  );
  const similarExamples = await findSimilarTaskExamples(user.id, task);
  executionResult({ inputSummary: `仅当前用户：当前任务、${String(subtasks.length)} 项子任务、${String(memory.length)} 条记忆` });
  const prompt = buildDecomposePrompt({
    taskTitle: task.title,
    notes: task.notesMd,
    deferCount: task.deferCount,
    estimateMinutes: task.estimateMinutes,
    existingSubtasks: subtasks.map((s) => s.title),
    memory: memory.map((m) => m.content),
    ...(similarExamples ? { similarExamples } : {}),
  });

  const result = await runWithCritic<ProposeSubtasksArgs>({
    user,
    job,
    capability: 'agent.decompose',
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
