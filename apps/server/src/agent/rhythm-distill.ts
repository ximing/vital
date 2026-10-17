import { randomUUID } from 'node:crypto';
import { isRhythmMemoryScope, parseRhythmMemory } from '@vital/dto';
import { and, arrayContains, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  agentMemory,
  agentMemoryHistory,
  outcomes,
  taskCompletions,
  tasks,
  users,
  type AgentJobRow,
  type AgentMemoryRow,
  type User,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { DeferredAgentJobError, LostAgentJobLeaseError, withAgentJobEffects } from './job-runtime.js';
import { runProposalPass } from './harness.js';
import { indexMemory, trackIndexJob } from '../retrieval/pipeline.js';
import {
  acceptRhythmEntries,
  aggregateRhythm,
  buildRhythmPrompt,
  profileFromMemories,
  suppressedFacets,
  type RhythmProfile,
} from './rhythm-profile.js';
import { submitRhythmTool, type SubmitRhythmArgs } from './tools.js';

/** Samples older than this are ignored. Two weeks inside the window is enough. */
const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export type RhythmDistillStatus = 'wrote' | 'skipped' | 'no-model' | 'failed';

export async function loadRhythmProfile(userId: string): Promise<RhythmProfile | null> {
  const rows = await getDb()
    .select({
      content: agentMemory.content,
      sourceCount: agentMemory.sourceCount,
      updatedAt: agentMemory.updatedAt,
      scope: agentMemory.scope,
    })
    .from(agentMemory)
    .where(and(eq(agentMemory.userId, userId), arrayContains(agentMemory.scope, ['profile'])))
    .orderBy(desc(agentMemory.updatedAt));
  return profileFromMemories(rows);
}

/** Consumers keep their previous behavior when the profile cannot be read. */
export async function loadRhythmProfileSafe(userId: string): Promise<RhythmProfile | null> {
  try {
    return await loadRhythmProfile(userId);
  } catch (err) {
    logger.info('rhythm profile unreadable', { userId, reason: err instanceof Error ? err.name : 'error' });
    return null;
  }
}

async function loadSample(user: User, now: Date) {
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const db = getDb();
  const [completions, defers, drops] = await Promise.all([
    db
      .select({
        completedAt: taskCompletions.completedAt,
        estimateMinutes: tasks.estimateMinutes,
        habitId: tasks.habitId,
      })
      .from(taskCompletions)
      .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
      .where(
        and(
          eq(tasks.userId, user.id),
          isNull(tasks.deletedAt),
          isNull(tasks.calendarKey),
          gte(taskCompletions.completedAt, since),
          lt(taskCompletions.completedAt, now),
        ),
      ),
    db
      .select({ title: tasks.title, outcomeName: outcomes.name, deferCount: tasks.deferCount })
      .from(tasks)
      .leftJoin(outcomes, and(eq(outcomes.id, tasks.outcomeId), eq(outcomes.userId, user.id)))
      .where(
        and(
          eq(tasks.userId, user.id),
          isNull(tasks.deletedAt),
          isNull(tasks.habitId),
          isNull(tasks.calendarKey),
          gte(tasks.deferCount, 1),
        ),
      ),
    db
      .select({ operation: agentMemoryHistory.operation, before: agentMemoryHistory.before })
      .from(agentMemoryHistory)
      .where(and(eq(agentMemoryHistory.userId, user.id), eq(agentMemoryHistory.operation, 'manual.drop')))
      .orderBy(desc(agentMemoryHistory.createdAt))
      .limit(200),
  ]);
  return { completions, defers, drops };
}

/**
 * profile.rhythm target of memory.distill.
 * Short samples and a missing model write nothing. Errors are not returned as profile text.
 */
export async function runRhythmDistill(user: User, job: AgentJobRow, now: Date): Promise<RhythmDistillStatus> {
  try {
    const sample = await loadSample(user, now);
    const completions = sample.completions.flatMap((row) =>
      row.habitId ? [] : [{ at: row.completedAt, estimateMinutes: row.estimateMinutes }],
    );
    const habitChecks = sample.completions.flatMap((row) => (row.habitId ? [{ at: row.completedAt }] : []));
    const facts = aggregateRhythm({
      zone: user.timezone || 'Asia/Shanghai',
      completions,
      habitChecks,
      defers: sample.defers,
    });
    const suppressed = suppressedFacets(sample.drops);
    const prompt = buildRhythmPrompt(facts, suppressed);
    if (!prompt) return 'skipped';
    const result = await runProposalPass<SubmitRhythmArgs>({
      user,
      capability: 'agent.distill',
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      makeTool: submitRhythmTool,
    });
    if (!result) return 'no-model';
    const accepted = acceptRhythmEntries(facts, suppressed, result.args.entries);
    if (accepted.length === 0) return 'skipped';
    const written = await withAgentJobEffects(job, async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('no key update');
      const current = await tx.select().from(agentMemory).where(eq(agentMemory.userId, user.id)).for('update');
      const saved: AgentMemoryRow[] = [];
      for (const entry of accepted) {
        const facetRows = current.filter((row) => parseRhythmMemory(row.content)?.facet === entry.facet && isRhythmMemoryScope(row.scope));
        if (facetRows.some((row) => row.manual)) continue;
        const existing = facetRows[0];
        if (existing) {
          if (existing.content === entry.content && existing.sourceCount === facts.sampleCount) continue;
          const [after] = await tx
            .update(agentMemory)
            .set({
              content: entry.content,
              sourceCount: facts.sampleCount,
              version: existing.version + 1,
              updatedAt: now,
            })
            .where(and(eq(agentMemory.userId, user.id), eq(agentMemory.id, existing.id), eq(agentMemory.manual, false)))
            .returning();
          if (!after) continue;
          await tx.insert(agentMemoryHistory).values({
            id: randomUUID(),
            userId: user.id,
            memoryId: after.id,
            revision: after.version,
            operation: 'update',
            before: existing,
            after,
            sourceFeedback: [],
            jobId: job.id,
            createdAt: now,
          });
          Object.assign(existing, after);
          saved.push(after);
          continue;
        }
        const [after] = await tx
          .insert(agentMemory)
          .values({
            id: randomUUID(),
            userId: user.id,
            kind: 'pattern',
            content: entry.content,
            sourceCount: facts.sampleCount,
            scope: ['profile'],
            manual: false,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!after) continue;
        await tx.insert(agentMemoryHistory).values({
          id: randomUUID(),
          userId: user.id,
          memoryId: after.id,
          revision: after.version,
          operation: 'add',
          before: null,
          after,
          sourceFeedback: [],
          jobId: job.id,
          createdAt: now,
        });
        current.push(after);
        saved.push(after);
      }
      return saved;
    });
    if (written.length > 0) {
      trackIndexJob(
        (async () => {
          for (const row of written) {
            await indexMemory(row).catch((err: unknown) => {
              logger.info('rhythm profile index skipped', { reason: err instanceof Error ? err.name : 'error' });
            });
          }
        })(),
        'rhythm profile index',
      );
    }
    return written.length > 0 ? 'wrote' : 'skipped';
  } catch (err) {
    if (err instanceof LostAgentJobLeaseError) throw err;
    logger.info('rhythm profile skipped', {
      userId: user.id,
      reason: err instanceof DeferredAgentJobError ? err.reason : err instanceof Error ? err.name : 'error',
    });
    return 'failed';
  }
}
