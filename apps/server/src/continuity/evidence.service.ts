import { randomUUID } from 'node:crypto';
import type {
  ContinuityEvidence,
  ContinuityEvidenceCreateInput,
  ContinuityEvidencePatchInput,
} from '@vital/dto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AgentJobTransaction } from '../agent/job-runtime.js';
import { isUniqueViolation } from '../db/pg.js';
import { getDb } from '../db/index.js';
import {
  continuityContracts,
  continuityEvidence,
  continuityEvidenceLinks,
  continuityOpportunities,
  type ContinuityEvidenceRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { insertContinuityEvent } from './continuity.service.js';
import { enqueueContinuityRecompute } from './enqueue.js';

function noteOf(body: Record<string, unknown>): string | null {
  const note = body.note;
  return typeof note === 'string' ? note : null;
}

function contractIdOf(body: Record<string, unknown>): string | null {
  const id = body.contractId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function toDto(row: ContinuityEvidenceRow, contractId: string | null): ContinuityEvidence {
  return {
    id: row.id,
    contractId,
    sourceType: 'self_report',
    actor: 'user',
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    body: noteOf(row.body),
    retractedAt: row.retractedAt ? row.retractedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadOwnedContract(
  tx: AgentJobTransaction,
  userId: string,
  contractId: string,
  forUpdate: boolean,
) {
  const base = tx
    .select()
    .from(continuityContracts)
    .where(and(eq(continuityContracts.id, contractId), eq(continuityContracts.userId, userId)))
    .limit(1);
  const [row] = forUpdate ? await base.for('update') : await base;
  if (!row || row.lifecycle === 'ended' || row.lifecycle === 'draft') {
    throw AppError.of(404, 'NOT_FOUND');
  }
  return row;
}

async function loadOwnedEvidence(tx: AgentJobTransaction, userId: string, id: string) {
  const [row] = await tx
    .select()
    .from(continuityEvidence)
    .where(and(eq(continuityEvidence.id, id), eq(continuityEvidence.userId, userId)))
    .limit(1)
    .for('update');
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

async function findByIdempotency(
  tx: Pick<ReturnType<typeof getDb>, 'select'>,
  userId: string,
  key: string,
): Promise<ContinuityEvidenceRow | null> {
  const [row] = await tx
    .select()
    .from(continuityEvidence)
    .where(and(eq(continuityEvidence.userId, userId), eq(continuityEvidence.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

async function incrementFacts(
  tx: AgentJobTransaction,
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

function evidenceBody(contractId: string, note: string | undefined): Record<string, unknown> {
  return note !== undefined && note.length > 0 ? { note, contractId } : { contractId };
}

export async function recordSelfReportInTx(
  tx: AgentJobTransaction,
  input: {
    userId: string;
    contractId: string;
    body?: string | undefined;
    occurredAt: Date;
    now: Date;
    idempotencyKey?: string | null;
    sourceId?: string | null;
    sourceRevision?: number | null;
  },
): Promise<ContinuityEvidence> {
  if (input.idempotencyKey) {
    const replayed = await findByIdempotency(tx, input.userId, input.idempotencyKey);
    if (replayed) return toDto(replayed, contractIdOf(replayed.body) ?? input.contractId);
  }
  await loadOwnedContract(tx, input.userId, input.contractId, true);
  const [row] = await tx
    .insert(continuityEvidence)
    .values({
      id: randomUUID(),
      userId: input.userId,
      sourceType: 'self_report',
      sourceId: input.sourceId ?? null,
      sourceRevision: input.sourceRevision ?? null,
      actor: 'user',
      occurredAt: input.occurredAt,
      recordedAt: input.now,
      body: evidenceBody(input.contractId, input.body),
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: input.now,
    })
    .returning();
  if (!row) throw new Error('continuity evidence missing after insert');
  await tx.insert(continuityEvidenceLinks).values({
    id: randomUUID(),
    userId: input.userId,
    evidenceId: row.id,
    contractId: input.contractId,
    opportunityId: null,
    meetsCriteria: true,
    rationale: 'self_report',
    createdAt: input.now,
  });
  await insertContinuityEvent(
    tx,
    input.userId,
    input.contractId,
    'evidence.recorded',
    { evidenceId: row.id, sourceType: 'self_report' },
    input.now,
  );
  await incrementFacts(tx, input.userId, input.contractId, input.now);
  return toDto(row, input.contractId);
}

export async function createContinuityEvidence(
  userId: string,
  input: ContinuityEvidenceCreateInput,
  now = new Date(),
): Promise<ContinuityEvidence> {
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
  try {
    return await getDb().transaction(async (tx) =>
      recordSelfReportInTx(tx, {
        userId,
        contractId: input.contractId,
        ...(input.body !== undefined ? { body: input.body } : {}),
        occurredAt,
        now,
        idempotencyKey: input.idempotencyKey ?? null,
      }),
    );
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const replayed = await findByIdempotency(getDb(), userId, input.idempotencyKey);
      if (replayed) return toDto(replayed, contractIdOf(replayed.body) ?? input.contractId);
    }
    throw err;
  }
}

export async function patchContinuityEvidence(
  userId: string,
  id: string,
  input: ContinuityEvidencePatchInput,
  now = new Date(),
): Promise<ContinuityEvidence> {
  return getDb().transaction(async (tx) => {
    const row = await loadOwnedEvidence(tx, userId, id);
    if (row.retractedAt) throw AppError.of(404, 'NOT_FOUND');
    const contractId = contractIdOf(row.body);
    const nextBody =
      input.body !== undefined && contractId
        ? evidenceBody(contractId, input.body)
        : input.body !== undefined
          ? { ...row.body, note: input.body }
          : row.body;
    const [updated] = await tx
      .update(continuityEvidence)
      .set({
        body: nextBody,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : row.occurredAt,
      })
      .where(eq(continuityEvidence.id, row.id))
      .returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    const bound = contractIdOf(updated.body);
    if (bound) {
      await insertContinuityEvent(
        tx,
        userId,
        bound,
        'evidence.corrected',
        { evidenceId: updated.id },
        now,
      );
      await incrementFacts(tx, userId, bound, now);
    }
    return toDto(updated, bound);
  });
}

export async function retractContinuityEvidence(
  userId: string,
  id: string,
  now = new Date(),
): Promise<ContinuityEvidence> {
  return getDb().transaction(async (tx) => {
    const row = await loadOwnedEvidence(tx, userId, id);
    if (row.retractedAt) return toDto(row, contractIdOf(row.body));
    const [updated] = await tx
      .update(continuityEvidence)
      .set({ retractedAt: now })
      .where(eq(continuityEvidence.id, row.id))
      .returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    const bound = contractIdOf(updated.body);
    if (bound) {
      await insertContinuityEvent(
        tx,
        userId,
        bound,
        'evidence.retracted',
        { evidenceId: updated.id },
        now,
      );
      await incrementFacts(tx, userId, bound, now);
    }
    return toDto(updated, bound);
  });
}

export async function occurredAtForDone(
  tx: AgentJobTransaction,
  contractId: string,
  now: Date,
): Promise<Date> {
  const [missed] = await tx
    .select({ startsAt: continuityOpportunities.startsAt })
    .from(continuityOpportunities)
    .where(
      and(
        eq(continuityOpportunities.contractId, contractId),
        eq(continuityOpportunities.status, 'missed'),
      ),
    )
    .orderBy(desc(continuityOpportunities.startsAt))
    .limit(1);
  return missed?.startsAt ?? now;
}
