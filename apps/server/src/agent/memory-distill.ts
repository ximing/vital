import { createHash, randomUUID } from 'node:crypto';
import { isRhythmMemoryScope } from '@vital/dto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { agentEditEvents, agentEditFeedback } from '../db/schema/agent-edit-events.js';
import { agentMemoryFeedback, agentMemoryHistory, agentMemoryMaintenance } from '../db/schema/agent-memory-history.js';
import {
  AGENT_MEMORY_SCOPES,
  agentActions,
  agentMemory,
  users,
  type AgentJobRow,
  type AgentMemoryRow,
  type AgentMemoryScope,
  type User,
} from '../db/schema.js';
import { memorySimilarityPairs } from '../retrieval/dedup.js';
import { indexMemory, removeMemoryIndex, trackIndexJob } from '../retrieval/pipeline.js';
import { executionResult, skipExecution } from './executions.service.js';
import { runProposalPass } from './harness.js';
import { RetryableAgentJobError, withAgentJobEffects } from './job-runtime.js';
import { finishUnchangedSchedule } from './processor-shared.js';
import type { AgentJobResult } from './processors.js';
import { buildDistillPrompt, type DistillActionFact, type DistillEditFact } from './prompts.js';
import { runRhythmDistill } from './rhythm-distill.js';
import { finishAgentSchedule } from './scheduling.js';
import { submitMemoriesTool, type SubmitMemoriesArgs } from './tools.js';

/** Governance budget: distill evicts stale non-manual rows beyond this total. */
const MEMORY_TOTAL_LIMIT = 30;
/**
 * New memories are never evicted during this window, even if the total exceeds
 * the cap — a productive distill may briefly go over 30.
 */
const MEMORY_EVICT_GRACE_MS = 7 * 24 * 3600 * 1000;

/** Model-provided scope lists are untrusted: keep known values only. */
function sanitizeScope(scope: string[] | undefined): AgentMemoryScope[] | null {
  if (!scope) return null;
  const valid = [...new Set(scope)].filter((s): s is AgentMemoryScope =>
    (AGENT_MEMORY_SCOPES as readonly string[]).includes(s),
  );
  return valid.length > 0 ? valid : null;
}

function memoryFingerprint(rows: { id: string; kind: string; content: string; scope: string[]; manual: boolean }[]): string {
  return createHash('sha256').update(JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, kind, content, scope, manual }) => ({ id, kind, content, scope, manual })))).digest('hex');
}

export async function processMemoryDistill(job: AgentJobRow, user: User, now: Date): Promise<AgentJobResult> {
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
    eq(agentActions.userId, user.id), inArray(agentActions.feedback, ['accepted', 'edited', 'dismissed', 'undone']),
    sql`coalesce(${agentActions.feedbackPayload}->>'superseded', '') <> 'true'`,
    sql`${agentActions.feedbackAt} is not null`,
    ...('scheduleFeedbackThrough' in job.payload && job.payload.scheduleFeedbackThrough ? [sql`${agentActions.feedbackAt} <= ${new Date(job.payload.scheduleFeedbackThrough)}`] : []),
    sql`not exists (select 1 from ${agentMemoryFeedback} p where p.user_id = ${agentActions.userId} and p.action_id = ${agentActions.id} and p.feedback_at = ${agentActions.feedbackAt} and p.version = md5(${agentActions.feedback} || ':' || coalesce(${agentActions.feedbackPayload}::text, 'null') || ':' || ${agentActions.feedbackAt}::text))`,
  )).orderBy(asc(agentActions.feedbackAt), asc(agentActions.id)).limit(50);
  // User edit events distill alongside feedback; rows are immutable so plain
  // event-id consumption markers suffice (no md5 version).
  const editCandidates = maintenance ? [] : await db.select().from(agentEditEvents).where(and(
    eq(agentEditEvents.userId, user.id),
    eq(agentEditEvents.source, 'user'),
    sql`not exists (select 1 from ${agentEditFeedback} f where f.user_id = ${agentEditEvents.userId} and f.event_id = ${agentEditEvents.id})`,
  )).orderBy(asc(agentEditEvents.createdAt), asc(agentEditEvents.id)).limit(50);
  if (!maintenance && candidates.length === 0 && editCandidates.length === 0) {
    return finishRhythmOnly(job, user.id, now);
  }
  const recent = candidates;
  executionResult({ inputSummary: `仅当前用户：${String(recent.length)} 条新反馈，${String(editCandidates.length)} 条用户编辑，${String(existing.length)} 条记忆` });
  const facts: DistillActionFact[] = recent.map(a => ({ actionType: a.actionType, feedback: a.feedback, summary: JSON.stringify(a.payload).slice(0, 200), editedSummary: a.feedbackPayload ? JSON.stringify(a.feedbackPayload).slice(0, 200) : null }));
  const editFacts: DistillEditFact[] = editCandidates.map(e => ({ entityType: e.entityType, fields: e.fields }));
  // Semantic dedup hint: near-duplicate existing memories are annotated in the
  // prompt so the model prefers update-merges over new adds. Best-effort — any
  // retrieval failure (or missing Qdrant) leaves the prompt as before.
  let similarPairs: [string, string][] | null = null;
  try {
    similarPairs = await memorySimilarityPairs(user.id);
  } catch (err) {
    console.error('[retrieval] memory.distill memorySimilarityPairs failed', err);
  }
  let similarPairsHint: [string, string][] | undefined;
  if (similarPairs && similarPairs.length > 0) {
    const existingIds = new Set(existing.map(m => m.id));
    // Index lag defense: drop pairs referencing ids no longer in PG.
    const fresh = similarPairs.filter(([a, b]) => existingIds.has(a) && existingIds.has(b));
    if (fresh.length > 0) similarPairsHint = fresh;
  }
  const governable = existing.filter((row) => !isRhythmMemoryScope(row.scope));
  const prompt = buildDistillPrompt({ actions: facts, existingMemory: governable, edits: editFacts, mode: maintenance ? 'maintenance' : 'incremental', ...(similarPairsHint ? { similarPairs: similarPairsHint } : {}) });
  const result = await runProposalPass<SubmitMemoriesArgs>({ user, capability: 'agent.distill', systemPrompt: prompt.system, userPrompt: prompt.user, makeTool: submitMemoriesTool });
  if (!result) return 'skipped:no-llm';
  const updates = (result.args.update ?? []).map(u => ({ id: u.id, content: u.content.trim(), scope: sanitizeScope(u.scope) })).filter(u => u.content !== '');
  const adds = (result.args.add ?? []).map(a => ({ kind: a.kind, content: a.content.trim(), scope: sanitizeScope(a.scope) })).filter(a => a.content !== '' && !isRhythmMemoryScope(a.scope ?? [])).slice(0, 5);
  const drops = new Set(result.args.drop ?? []);
  // Rows whose derived index entries change in the distill transaction;
  // reindexed fire-and-forget after commit (never inside, never blocking).
  const indexUpserts: AgentMemoryRow[] = [];
  const indexRemovals: string[] = [];
  const evictedIds: string[] = [];
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
    for (const e of editCandidates) {
      const consumed = await tx.insert(agentEditFeedback).values({ userId: user.id, eventId: e.id, jobId: job.id, processedAt: now }).onConflictDoNothing().returning();
      if (!consumed.length) throw new RetryableAgentJobError('Edit event already processed by another distill');
    }
    const counts = { added: 0, updated: 0, deleted: 0 };
    const history = async (operation: string, before: typeof agentMemory.$inferSelect | null, after: typeof agentMemory.$inferSelect | null) => {
      const row = after ?? before;
      if (!row) return;
      await tx.insert(agentMemoryHistory).values({ id: randomUUID(), userId: user.id, memoryId: row.id, revision: after?.version ?? row.version + 1, operation, before, after, sourceFeedback: sources, jobId: job.id, createdAt: now });
    };
    for (const u of updates) {
      const before = current.find(m => m.id === u.id && !m.manual);
      if (!before || drops.has(u.id) || isRhythmMemoryScope(before.scope)) continue;
      const scope = u.scope && !isRhythmMemoryScope(u.scope) ? u.scope : before.scope;
      if (before.content === u.content && JSON.stringify(before.scope) === JSON.stringify(scope)) continue;
      const [after] = await tx.update(agentMemory).set({ content: u.content, scope, version: before.version + 1, sourceCount: before.sourceCount + sources.length, updatedAt: now }).where(and(eq(agentMemory.userId, user.id), eq(agentMemory.id, u.id), eq(agentMemory.manual, false))).returning();
      if (after) { counts.updated++; await history('update', before, after); Object.assign(before, after); indexUpserts.push(after); }
    }
    for (const before of current.filter(m => !m.manual && drops.has(m.id) && !isRhythmMemoryScope(m.scope))) {
      const removed = await tx.delete(agentMemory).where(and(eq(agentMemory.userId, user.id), eq(agentMemory.id, before.id), eq(agentMemory.manual, false))).returning();
      if (removed.length) { counts.deleted++; await history('drop', before, null); indexRemovals.push(before.id); }
    }
    for (const a of adds) {
      const duplicate = current.some(m => !drops.has(m.id) && m.content === a.content && m.kind === a.kind);
      if (duplicate) continue;
      const [after] = await tx.insert(agentMemory).values({ id: randomUUID(), userId: user.id, kind: a.kind, content: a.content, sourceCount: sources.length, scope: a.scope ?? ['all'], createdAt: now, updatedAt: now }).returning();
      if (after) { counts.added++; await history('add', null, after); current.push(after); indexUpserts.push(after); }
    }
    const all = await tx.select().from(agentMemory).where(eq(agentMemory.userId, user.id));
    let over = all.length - MEMORY_TOTAL_LIMIT;
    if (over > 0) {
      const graceBefore = new Date(now.getTime() - MEMORY_EVICT_GRACE_MS);
      const evictable = all
        .filter((row) => !row.manual && !isRhythmMemoryScope(row.scope) && row.createdAt < graceBefore)
        .sort((a, b) => {
          const aKey = (a.lastRetrievedAt ?? a.createdAt).getTime();
          const bKey = (b.lastRetrievedAt ?? b.createdAt).getTime();
          if (aKey !== bKey) return aKey - bKey;
          return a.id.localeCompare(b.id);
        });
      for (const before of evictable) {
        if (over <= 0) break;
        const removed = await tx.delete(agentMemory).where(and(eq(agentMemory.userId, user.id), eq(agentMemory.id, before.id), eq(agentMemory.manual, false))).returning();
        if (removed.length) {
          over--;
          counts.deleted++;
          evictedIds.push(before.id);
          await history('evict', before, null);
          indexRemovals.push(before.id);
        }
      }
    }
    const final = await tx.select().from(agentMemory).where(eq(agentMemory.userId, user.id));
    if (maintenance) await tx.insert(agentMemoryMaintenance).values({ userId: user.id, fingerprint: memoryFingerprint(final), updatedAt: now }).onConflictDoUpdate({ target: agentMemoryMaintenance.userId, set: { fingerprint: memoryFingerprint(final), updatedAt: now } });
    if (!maintenance && 'scheduleGeneration' in job.payload && typeof job.payload.scheduleGeneration === 'number') await finishAgentSchedule(tx, user.id, 'memory.distill', job.payload.scheduleGeneration, now);
    return counts;
  });
  // Fire-and-forget reindex after commit. Sequential (upserts before removals)
  // so a row updated then evicted in the same run ends up removed; per-item
  // failures are logged without failing the batch, and index.sync heals drift.
  if (indexUpserts.length > 0 || indexRemovals.length > 0) {
    trackIndexJob(
      (async () => {
        for (const row of indexUpserts) {
          await indexMemory(row).catch((err: unknown) => {
            console.error('[retrieval] memory.distill indexMemory failed', err);
          });
        }
        for (const id of indexRemovals) {
          await removeMemoryIndex(id).catch((err: unknown) => {
            console.error('[retrieval] memory.distill removeMemoryIndex failed', err);
          });
        }
      })(),
      'memory.distill reindex',
    );
  }
  const evictionNote =
    evictedIds.length > 0
      ? `；按检索价值淘汰 ${String(evictedIds.length)} 条（${evictedIds.join('、')}）`
      : '';
  const rhythm = await runRhythmDistill(user, job, now);
  if (maintenance) await sealMaintenanceFingerprint(user.id, now);
  const rhythmNote = rhythm === 'wrote' ? '；节奏画像已更新' : rhythm === 'failed' ? '；节奏画像未生成' : '';
  executionResult({ resultSummary: `记忆整理：新增 ${String(counts.added)}，更新 ${String(counts.updated)}，删除 ${String(counts.deleted)}${evictionNote}${rhythmNote}` });
  if (counts.added + counts.updated + counts.deleted === 0 && rhythm !== 'wrote') skipExecution('NO_CHANGES');
  return 'done';
}

/** No new feedback: still try profile.rhythm. A short sample or a missing model writes nothing. */
async function finishRhythmOnly(job: AgentJobRow, userId: string, now: Date): Promise<AgentJobResult> {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  const rhythm = user ? await runRhythmDistill(user, job, now) : 'skipped';
  await finishUnchangedSchedule(job, userId, 'memory.distill', now);
  if (rhythm === 'no-model') {
    skipExecution('NO_MODEL');
    return 'skipped:no-llm';
  }
  if (rhythm === 'wrote') {
    executionResult({ resultSummary: '节奏画像已更新', inputSummary: 'profile.rhythm' });
    return 'done';
  }
  if (rhythm === 'failed') {
    executionResult({ resultSummary: '节奏画像未生成', inputSummary: 'profile.rhythm' });
    return 'done';
  }
  skipExecution('UNCHANGED_INPUT');
  return 'done';
}

async function sealMaintenanceFingerprint(userId: string, now: Date): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');
    const final = await tx.select().from(agentMemory).where(eq(agentMemory.userId, userId));
    const fingerprint = memoryFingerprint(final);
    await tx.insert(agentMemoryMaintenance).values({ userId, fingerprint, updatedAt: now }).onConflictDoUpdate({
      target: agentMemoryMaintenance.userId,
      set: { fingerprint, updatedAt: now },
    });
  });
}
