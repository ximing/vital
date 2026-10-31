import { randomUUID } from 'node:crypto';
import type {
  ContinuityBlockedType,
  ContinuityDependency,
  ContinuityDependencyList,
  ContinuityPrerequisiteType,
  CreateContinuityDependencyInput,
  PatchContinuityDependencyInput,
} from '@vital/dto';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { AgentDb } from '../agent/jobs.js';
import { getDb } from '../db/index.js';
import {
  continuityContracts,
  continuityDependencies,
  outcomes,
  tasks,
  type ContinuityContractRow,
  type ContinuityDependencyRow,
  type TaskRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getOwnedOutcomeOr404 } from '../outcomes/shared.js';
import { enqueueContinuityRecompute } from './enqueue.js';

const OPEN_TASK = ['todo', 'doing'] as const;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toDto(row: ContinuityDependencyRow): ContinuityDependency {
  return {
    id: row.id,
    contractId: row.contractId,
    blockedType: row.blockedType as ContinuityBlockedType,
    blockedId: row.blockedId,
    prerequisiteType: row.prerequisiteType as ContinuityPrerequisiteType,
    prerequisiteId: row.prerequisiteId,
    externalLabel: row.externalLabel,
    status: row.status as ContinuityDependency['status'],
    resolvedAt: iso(row.resolvedAt),
    lastUserUpdateAt: iso(row.lastUserUpdateAt),
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadContractForOutcome(
  tx: AgentDb,
  userId: string,
  outcomeId: string,
): Promise<ContinuityContractRow> {
  await getOwnedOutcomeOr404(userId, outcomeId);
  const [row] = await tx
    .select()
    .from(continuityContracts)
    .where(and(eq(continuityContracts.userId, userId), eq(continuityContracts.outcomeId, outcomeId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

async function loadOwnedDependency(
  tx: AgentDb,
  userId: string,
  id: string,
): Promise<ContinuityDependencyRow> {
  const [row] = await tx
    .select()
    .from(continuityDependencies)
    .where(and(eq(continuityDependencies.id, id), eq(continuityDependencies.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

async function ownedTask(
  tx: AgentDb,
  userId: string,
  id: string,
): Promise<Pick<TaskRow, 'id' | 'userId' | 'deletedAt'>> {
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!row || row.userId !== userId || row.deletedAt) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

async function ownedOutcome(tx: AgentDb, userId: string, id: string): Promise<void> {
  const [row] = await tx.select({ id: outcomes.id, userId: outcomes.userId }).from(outcomes).where(eq(outcomes.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'NOT_FOUND');
}

async function assertInternalRef(
  tx: AgentDb,
  userId: string,
  type: 'task' | 'outcome',
  id: string,
): Promise<void> {
  if (type === 'task') await ownedTask(tx, userId, id);
  else await ownedOutcome(tx, userId, id);
}

function nodeKey(type: string, id: string): string {
  return `${type}:${id}`;
}

async function assertNoCycle(
  tx: AgentDb,
  userId: string,
  blockedType: 'task' | 'outcome',
  blockedId: string,
  prerequisiteType: 'task' | 'outcome',
  prerequisiteId: string,
): Promise<void> {
  if (blockedType === prerequisiteType && blockedId === prerequisiteId) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const rows = await tx
    .select({
      blockedType: continuityDependencies.blockedType,
      blockedId: continuityDependencies.blockedId,
      prerequisiteType: continuityDependencies.prerequisiteType,
      prerequisiteId: continuityDependencies.prerequisiteId,
    })
    .from(continuityDependencies)
    .where(
      and(
        eq(continuityDependencies.userId, userId),
        eq(continuityDependencies.status, 'open'),
        inArray(continuityDependencies.prerequisiteType, ['task', 'outcome']),
      ),
    );
  const adj = new Map<string, string[]>();
  function addEdge(from: string, to: string): void {
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }
  for (const row of rows) {
    if (!row.prerequisiteId) continue;
    addEdge(nodeKey(row.blockedType, row.blockedId), nodeKey(row.prerequisiteType, row.prerequisiteId));
  }
  const start = nodeKey(prerequisiteType, prerequisiteId);
  const target = nodeKey(blockedType, blockedId);
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    if (cur === target) throw AppError.of(400, 'VALIDATION_ERROR');
    for (const next of adj.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
}

async function bumpAndEnqueue(
  tx: AgentDb,
  userId: string,
  contractId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(continuityContracts)
    .set({ factsVersion: sql`${continuityContracts.factsVersion} + 1`, updatedAt: now })
    .where(and(eq(continuityContracts.id, contractId), eq(continuityContracts.userId, userId)));
  await enqueueContinuityRecompute(tx, userId, contractId, now);
}

export async function listContinuityDependencies(
  userId: string,
  outcomeId: string,
): Promise<ContinuityDependencyList> {
  const contract = await loadContractForOutcome(getDb(), userId, outcomeId);
  const rows = await getDb()
    .select()
    .from(continuityDependencies)
    .where(
      and(
        eq(continuityDependencies.userId, userId),
        eq(continuityDependencies.contractId, contract.id),
        ne(continuityDependencies.status, 'canceled'),
      ),
    );
  return { items: rows.map(toDto) };
}

export async function createContinuityDependency(
  userId: string,
  outcomeId: string,
  input: CreateContinuityDependencyInput,
): Promise<ContinuityDependency> {
  return getDb().transaction(async (tx) => {
    const contract = await loadContractForOutcome(tx, userId, outcomeId);
    const blockedType = input.blockedType ?? 'outcome';
    const blockedId = input.blockedId ?? outcomeId;
    await assertInternalRef(tx, userId, blockedType, blockedId);
    const now = new Date();
    if (input.prerequisiteType === 'external') {
      const label = input.externalLabel?.trim() ?? '';
      if (label === '') throw AppError.of(400, 'VALIDATION_ERROR');
      const [inserted] = await tx
        .insert(continuityDependencies)
        .values({
          id: randomUUID(),
          userId,
          contractId: contract.id,
          blockedType,
          blockedId,
          prerequisiteType: 'external',
          prerequisiteId: null,
          externalLabel: label,
          status: 'open',
          revision: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!inserted) throw AppError.of(500, 'INTERNAL_ERROR');
      await bumpAndEnqueue(tx, userId, contract.id, now);
      return toDto(inserted);
    }
    const prerequisiteId = input.prerequisiteId;
    if (!prerequisiteId) throw AppError.of(400, 'VALIDATION_ERROR');
    await assertInternalRef(tx, userId, input.prerequisiteType, prerequisiteId);
    await assertNoCycle(tx, userId, blockedType, blockedId, input.prerequisiteType, prerequisiteId);
    const [existing] = await tx
      .select()
      .from(continuityDependencies)
      .where(
        and(
          eq(continuityDependencies.userId, userId),
          eq(continuityDependencies.contractId, contract.id),
          eq(continuityDependencies.blockedType, blockedType),
          eq(continuityDependencies.blockedId, blockedId),
          eq(continuityDependencies.prerequisiteType, input.prerequisiteType),
          eq(continuityDependencies.prerequisiteId, prerequisiteId),
          eq(continuityDependencies.status, 'open'),
        ),
      )
      .limit(1);
    if (existing) return toDto(existing);
    const [inserted] = await tx
      .insert(continuityDependencies)
      .values({
        id: randomUUID(),
        userId,
        contractId: contract.id,
        blockedType,
        blockedId,
        prerequisiteType: input.prerequisiteType,
        prerequisiteId,
        externalLabel: null,
        status: 'open',
        revision: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!inserted) throw AppError.of(500, 'INTERNAL_ERROR');
    await bumpAndEnqueue(tx, userId, contract.id, now);
    return toDto(inserted);
  });
}

export async function patchContinuityDependency(
  userId: string,
  id: string,
  input: PatchContinuityDependencyInput,
): Promise<ContinuityDependency> {
  return getDb().transaction(async (tx) => {
    const row = await loadOwnedDependency(tx, userId, id);
    const now = new Date();
    const nextStatus = input.status;
    const [updated] = await tx
      .update(continuityDependencies)
      .set({
        status: nextStatus,
        resolvedAt: nextStatus === 'resolved' ? (row.resolvedAt ?? now) : null,
        lastUserUpdateAt: now,
        revision: row.revision + 1,
        updatedAt: now,
      })
      .where(eq(continuityDependencies.id, row.id))
      .returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    await bumpAndEnqueue(tx, userId, row.contractId, now);
    return toDto(updated);
  });
}

export async function deleteContinuityDependency(userId: string, id: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const row = await loadOwnedDependency(tx, userId, id);
    const now = new Date();
    await tx.delete(continuityDependencies).where(eq(continuityDependencies.id, row.id));
    await bumpAndEnqueue(tx, userId, row.contractId, now);
  });
}

async function remainingOpenTasks(
  tx: AgentDb,
  userId: string,
  outcomeId: string,
): Promise<number> {
  const rows = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.outcomeId, outcomeId),
        inArray(tasks.status, [...OPEN_TASK]),
        isNull(tasks.deletedAt),
      ),
    );
  return rows.length;
}

async function enqueueContracts(tx: AgentDb, userId: string, contractIds: Iterable<string>, now: Date) {
  const seen = new Set<string>();
  for (const id of contractIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    await enqueueContinuityRecompute(tx, userId, id, now);
  }
}

/**
 * Same-transaction: resolve internal prereqs on complete, reopen on uncomplete,
 * and wake the blocked contract plus the task's own hosted outcome.
 */
export async function syncContinuityOnTaskComplete(
  tx: AgentDb,
  userId: string,
  task: Pick<TaskRow, 'id' | 'outcomeId'>,
  now: Date,
): Promise<void> {
  const contractIds = new Set<string>();
  const taskDeps = await tx
    .select()
    .from(continuityDependencies)
    .where(
      and(
        eq(continuityDependencies.userId, userId),
        eq(continuityDependencies.prerequisiteType, 'task'),
        eq(continuityDependencies.prerequisiteId, task.id),
        eq(continuityDependencies.status, 'open'),
      ),
    );
  for (const row of taskDeps) {
    await tx
      .update(continuityDependencies)
      .set({ status: 'resolved', resolvedAt: now, updatedAt: now, revision: row.revision + 1 })
      .where(eq(continuityDependencies.id, row.id));
    contractIds.add(row.contractId);
  }
  if (task.outcomeId && (await remainingOpenTasks(tx, userId, task.outcomeId)) === 0) {
    const outcomeDeps = await tx
      .select()
      .from(continuityDependencies)
      .where(
        and(
          eq(continuityDependencies.userId, userId),
          eq(continuityDependencies.prerequisiteType, 'outcome'),
          eq(continuityDependencies.prerequisiteId, task.outcomeId),
          eq(continuityDependencies.status, 'open'),
        ),
      );
    for (const row of outcomeDeps) {
      await tx
        .update(continuityDependencies)
        .set({ status: 'resolved', resolvedAt: now, updatedAt: now, revision: row.revision + 1 })
        .where(eq(continuityDependencies.id, row.id));
      contractIds.add(row.contractId);
    }
  }
  if (task.outcomeId) {
    const [own] = await tx
      .select({ id: continuityContracts.id })
      .from(continuityContracts)
      .where(
        and(eq(continuityContracts.userId, userId), eq(continuityContracts.outcomeId, task.outcomeId)),
      )
      .limit(1);
    if (own) contractIds.add(own.id);
  }
  await enqueueContracts(tx, userId, contractIds, now);
}

export async function syncContinuityOnTaskUncomplete(
  tx: AgentDb,
  userId: string,
  task: Pick<TaskRow, 'id' | 'outcomeId'>,
  now: Date,
): Promise<void> {
  const contractIds = new Set<string>();
  const taskDeps = await tx
    .select()
    .from(continuityDependencies)
    .where(
      and(
        eq(continuityDependencies.userId, userId),
        eq(continuityDependencies.prerequisiteType, 'task'),
        eq(continuityDependencies.prerequisiteId, task.id),
        eq(continuityDependencies.status, 'resolved'),
      ),
    );
  for (const row of taskDeps) {
    await tx
      .update(continuityDependencies)
      .set({ status: 'open', resolvedAt: null, updatedAt: now, revision: row.revision + 1 })
      .where(eq(continuityDependencies.id, row.id));
    contractIds.add(row.contractId);
  }
  if (task.outcomeId) {
    const outcomeDeps = await tx
      .select()
      .from(continuityDependencies)
      .where(
        and(
          eq(continuityDependencies.userId, userId),
          eq(continuityDependencies.prerequisiteType, 'outcome'),
          eq(continuityDependencies.prerequisiteId, task.outcomeId),
          eq(continuityDependencies.status, 'resolved'),
        ),
      );
    for (const row of outcomeDeps) {
      await tx
        .update(continuityDependencies)
        .set({ status: 'open', resolvedAt: null, updatedAt: now, revision: row.revision + 1 })
        .where(eq(continuityDependencies.id, row.id));
      contractIds.add(row.contractId);
    }
    const [own] = await tx
      .select({ id: continuityContracts.id })
      .from(continuityContracts)
      .where(
        and(eq(continuityContracts.userId, userId), eq(continuityContracts.outcomeId, task.outcomeId)),
      )
      .limit(1);
    if (own) contractIds.add(own.id);
  }
  await enqueueContracts(tx, userId, contractIds, now);
}
