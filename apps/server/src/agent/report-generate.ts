import { randomUUID } from 'node:crypto';
import { extractNotes, replaceNotes } from '@vital/dto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { reports, type AgentJobRow, type User } from '../db/schema.js';
import { getReportReview } from '../reports/overview.service.js';
import { recordAgentAction } from './action-ledger.js';
import { executionResult, skipExecution } from './executions.service.js';
import { loadAgentMemory, runWithCritic } from './harness.js';
import { withAgentJobEffects } from './job-runtime.js';
import type { AgentJobResult } from './processors.js';
import { buildReportPrompt } from './prompts.js';
import { submitReportTool, type SubmitReportArgs } from './tools.js';

function sanitizeReportNotes(raw: string): string {
  let notes = raw.trim();
  notes = notes.replace(/^#+\s*.+\n+/, '');
  notes = notes.replace(/^##\s*记录\s*\n+/, '');
  notes = notes.replace(/\[\[[^\]]+\]\]/g, '').trim();
  return notes.slice(0, 4000);
}

/** Manual: write the daily report's notes section from that period's facts. */
export async function processReportGenerate(
  job: AgentJobRow,
  user: User,
  now: Date,
): Promise<AgentJobResult> {
  if (!('reportId' in job.payload)) { skipExecution('INVALID_PAYLOAD'); return 'done'; }
  const reportId = job.payload.reportId;
  const db = getDb();
  const [row] = await db.select().from(reports).where(and(eq(reports.id, reportId), eq(reports.userId, user.id))).limit(1);
  if (!row) { skipExecution('REPORT_NOT_FOUND'); return 'done'; }
  if (row.type !== 'daily') { skipExecution('NOT_DAILY'); return 'done'; }

  const notesAtStart = extractNotes(row.bodyMd, 'daily');
  const review = await getReportReview(user.id, reportId);
  const memory = await loadAgentMemory(user.id, 'report', row.title);
  executionResult({
    inputSummary: `仅当前用户：完成 ${String(review.completed.length)}、结转 ${String(review.carried.length)}、收集 ${String(review.captured.length)}、习惯 ${String(review.habitProgress.length)}、${String(memory.length)} 条记忆`,
    targetType: 'report',
    targetId: reportId,
  });
  const prompt = buildReportPrompt({
    title: row.title,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    completed: review.completed.slice(0, 30).map((item) => ({ title: item.title })),
    carried: review.carried.slice(0, 20).map((item) => ({ title: item.title, dueAt: item.dueAt })),
    captured: review.captured.slice(0, 15).map((item) => ({ title: item.title })),
    habits: review.habitProgress.slice(0, 10).map((item) => ({
      title: item.title,
      done: item.done,
      target: item.target,
    })),
    existingNotes: notesAtStart,
    memory: memory.map((m) => m.content),
  });

  const result = await runWithCritic<SubmitReportArgs>({
    user,
    job,
    capability: 'agent.report',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    makeTool: submitReportTool,
  });
  if (!result) return 'skipped:no-llm';

  const notes = sanitizeReportNotes(result.args.notes);
  if (notes === '') { skipExecution('EMPTY_NOTES'); return 'done'; }

  await withAgentJobEffects(job, async (tx) => {
    const [current] = await tx.select().from(reports).where(and(eq(reports.userId, user.id), eq(reports.id, reportId))).for('update');
    if (!current) { skipExecution('REPORT_NOT_FOUND'); return; }
    if (current.type !== 'daily') { skipExecution('NOT_DAILY'); return; }
    if (extractNotes(current.bodyMd, 'daily') !== notesAtStart) { skipExecution('NOTES_CHANGED'); return; }
    const bodyMd = replaceNotes(current.bodyMd, 'daily', notes);
    if (bodyMd === current.bodyMd) { skipExecution('NO_CHANGES'); return; }
    const [updated] = await tx.update(reports).set({
      bodyMd,
      revision: current.revision + 1,
      updatedAt: now,
    }).where(and(eq(reports.id, reportId), eq(reports.userId, user.id), eq(reports.revision, current.revision))).returning();
    if (!updated) { skipExecution('NOTES_CHANGED'); return; }
    await recordAgentAction(tx, {
      id: randomUUID(),
      userId: user.id,
      jobId: job.id,
      actionType: 'report.generate',
      targetType: 'report',
      targetId: reportId,
      payload: { notes },
      feedback: 'accepted',
    });
    executionResult({ resultSummary: '已写入日报记录' });
  });
  return 'done';
}
