import { randomUUID } from 'node:crypto';
import type {
  ContinuityCadence,
  ContinuityExperiment,
  ContinuityExperimentBaseline,
  ContinuityExperimentCreateInput,
  ContinuityExperimentGoal,
  ContinuityExperimentReview,
  ContinuityMinAction,
} from '@vital/dto';
import {
  continuityExperimentBaselineSchema,
  continuityExperimentGoalSchema,
  continuityExperimentReviewSchema,
} from '@vital/dto';
import { and, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { AgentJobTransaction } from '../agent/job-runtime.js';
import { isUniqueViolation } from '../db/pg.js';
import { getDb } from '../db/index.js';
import {
  continuityContractRevisions,
  continuityContracts,
  continuityExperiments,
  continuityOpportunities,
  type ContinuityContractRevisionRow,
  type ContinuityContractRow,
  type ContinuityExperimentRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { insertContinuityEvent, writeActiveContractRevision } from './continuity.service.js';
import { enqueueContinuityRecompute } from './enqueue.js';
import { isContinuityEnabled } from './flag.js';
import { isProgressEvidence, supersededIdsOf } from './rules/evidence.js';
import type { Evidence, EvidenceLink, Opportunity } from './rules/types.js';

const OPEN_STATUSES = ['draft', 'active', 'review_ready'] as const;
const DEFAULT_HYPOTHESIS = '调整约定，观察一个周期是否更容易开始';

function iso(value: Date): string {
  return value.toISOString();
}

function cycleEnd(timezone: string, now: Date): Date {
  return DateTime.fromJSDate(now, { zone: timezone }).plus({ days: 7 }).toJSDate();
}

function targetOf(cadence: ContinuityCadence): number {
  if (cadence.kind === 'weekly_count') return cadence.count;
  return cadence.slots.length;
}

function parseBaseline(raw: unknown, fallback: ContinuityExperimentBaseline): ContinuityExperimentBaseline {
  const parsed = continuityExperimentBaselineSchema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

function parseGoal(raw: unknown, fallback: ContinuityExperimentGoal): ContinuityExperimentGoal {
  const parsed = continuityExperimentGoalSchema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

function parseReview(raw: unknown): ContinuityExperimentReview | null {
  const parsed = continuityExperimentReviewSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function toDto(
  row: ContinuityExperimentRow,
  outcomeId: string,
  fallbackCadence: ContinuityCadence,
  fallbackMinAction: ContinuityMinAction,
): ContinuityExperiment {
  const fallbackGoal = { cadence: fallbackCadence, minAction: fallbackMinAction };
  return {
    id: row.id,
    contractId: row.contractId,
    outcomeId,
    beforeRevision: row.beforeRevision,
    afterRevision: row.afterRevision,
    hypothesis: row.hypothesis,
    baseline: parseBaseline(row.baseline, {
      ...fallbackGoal,
      validOpportunityCount: 0,
      progressCount: 0,
      incomparable: true,
    }),
    goal: parseGoal(row.goal, fallbackGoal),
    windowStart: iso(row.windowStart),
    windowEnd: iso(row.windowEnd),
    status: row.status as ContinuityExperiment['status'],
    review: parseReview(row.review),
    reviewVersion: row.reviewVersion,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function loadOwnedContract(
  tx: AgentJobTransaction,
  userId: string,
  contractId: string,
): Promise<ContinuityContractRow> {
  const [row] = await tx
    .select()
    .from(continuityContracts)
    .where(and(eq(continuityContracts.id, contractId), eq(continuityContracts.userId, userId)))
    .limit(1)
    .for('update');
  if (!row || row.lifecycle !== 'active') throw AppError.of(404, 'NOT_FOUND');
  return row;
}

async function loadRevision(
  tx: AgentJobTransaction,
  contractId: string,
  revision: number,
): Promise<ContinuityContractRevisionRow> {
  const [row] = await tx
    .select()
    .from(continuityContractRevisions)
    .where(
      and(
        eq(continuityContractRevisions.contractId, contractId),
        eq(continuityContractRevisions.revision, revision),
      ),
    )
    .limit(1);
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

async function freezeBaseline(
  tx: AgentJobTransaction,
  contractId: string,
  revision: ContinuityContractRevisionRow,
  now: Date,
): Promise<ContinuityExperimentBaseline> {
  const rows = await tx
    .select()
    .from(continuityOpportunities)
    .where(
      and(
        eq(continuityOpportunities.contractId, contractId),
        eq(continuityOpportunities.revision, revision.revision),
      ),
    );
  const valid = rows.filter(
    (row) =>
      row.status !== 'exempt' &&
      row.status !== 'canceled' &&
      row.checkAt.getTime() <= now.getTime(),
  );
  const progressCount = valid.filter((row) => row.status === 'met').length;
  return {
    cadence: revision.cadence,
    minAction: revision.minAction,
    validOpportunityCount: valid.length,
    progressCount,
    incomparable: valid.length === 0,
  };
}

export async function interruptOpenExperiments(
  tx: AgentJobTransaction,
  contractId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(continuityExperiments)
    .set({ status: 'interrupted', updatedAt: now })
    .where(
      and(
        eq(continuityExperiments.contractId, contractId),
        inArray(continuityExperiments.status, [...OPEN_STATUSES]),
      ),
    );
}

async function supersedeOpen(
  tx: AgentJobTransaction,
  contractId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(continuityExperiments)
    .set({ status: 'superseded', updatedAt: now })
    .where(
      and(
        eq(continuityExperiments.contractId, contractId),
        inArray(continuityExperiments.status, [...OPEN_STATUSES]),
      ),
    );
}

async function loadOpen(
  tx: AgentJobTransaction,
  contractId: string,
): Promise<ContinuityExperimentRow[]> {
  return tx
    .select()
    .from(continuityExperiments)
    .where(
      and(
        eq(continuityExperiments.contractId, contractId),
        inArray(continuityExperiments.status, [...OPEN_STATUSES]),
      ),
    )
    .for('update');
}

export async function startContinuityExperimentInTx(
  tx: AgentJobTransaction,
  input: {
    userId: string;
    contractId: string;
    hypothesis?: string | undefined;
    cadence?: ContinuityCadence | undefined;
    minAction?: ContinuityMinAction | undefined;
    now: Date;
    supersede: boolean;
  },
): Promise<ContinuityExperiment> {
  const writesCadence = input.cadence !== undefined || input.minAction !== undefined;
  if (writesCadence && !isContinuityEnabled()) throw AppError.of(403, 'CONTINUITY_DISABLED');

  const contract = await loadOwnedContract(tx, input.userId, input.contractId);
  const open = await loadOpen(tx, contract.id);
  if (open.length > 0 && !input.supersede) {
    throw AppError.of(409, 'CONTINUITY_EXPERIMENT_ACTIVE');
  }
  if (open.length > 0) await supersedeOpen(tx, contract.id, input.now);

  const before = await loadRevision(tx, contract.id, contract.currentRevision);
  const baseline = await freezeBaseline(tx, contract.id, before, input.now);
  const written = await writeActiveContractRevision(
    tx,
    input.userId,
    contract,
    {
      ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
      ...(input.minAction !== undefined ? { minAction: input.minAction } : {}),
    },
    input.now,
  );
  const after = written.revision;
  const windowStart = input.now;
  const windowEnd = cycleEnd(after.timezone, input.now);
  const hypothesis = input.hypothesis?.trim() ? input.hypothesis.trim() : DEFAULT_HYPOTHESIS;
  const goal: ContinuityExperimentGoal = { cadence: after.cadence, minAction: after.minAction };

  const [row] = await tx
    .insert(continuityExperiments)
    .values({
      id: randomUUID(),
      userId: input.userId,
      contractId: contract.id,
      beforeRevision: before.revision,
      afterRevision: after.revision,
      hypothesis,
      baseline,
      goal,
      windowStart,
      windowEnd,
      status: 'active',
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();
  if (!row) throw new Error('continuity experiment missing after insert');
  await insertContinuityEvent(
    tx,
    input.userId,
    contract.id,
    'experiment.started',
    { experimentId: row.id, beforeRevision: before.revision, afterRevision: after.revision },
    input.now,
  );
  if (!written.changed) {
    await enqueueContinuityRecompute(tx, input.userId, contract.id, input.now);
  }
  return toDto(row, contract.outcomeId, after.cadence, after.minAction);
}

export async function createContinuityExperiment(
  userId: string,
  input: ContinuityExperimentCreateInput,
  now = new Date(),
): Promise<ContinuityExperiment> {
  try {
    return await getDb().transaction(async (tx) =>
      startContinuityExperimentInTx(tx, {
        userId,
        contractId: input.contractId,
        ...(input.hypothesis !== undefined ? { hypothesis: input.hypothesis } : {}),
        ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
        ...(input.minAction !== undefined ? { minAction: input.minAction } : {}),
        now,
        supersede: false,
      }),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.of(409, 'CONTINUITY_EXPERIMENT_ACTIVE');
    throw err;
  }
}

export async function getContinuityExperiment(
  userId: string,
  id: string,
): Promise<ContinuityExperiment> {
  const [joined] = await getDb()
    .select({
      experiment: continuityExperiments,
      outcomeId: continuityContracts.outcomeId,
    })
    .from(continuityExperiments)
    .innerJoin(continuityContracts, eq(continuityContracts.id, continuityExperiments.contractId))
    .where(and(eq(continuityExperiments.id, id), eq(continuityExperiments.userId, userId)))
    .limit(1);
  if (!joined) throw AppError.of(404, 'NOT_FOUND');
  const fallback = parseGoal(joined.experiment.goal, {
    cadence: { kind: 'weekly_count', count: 2, durationMin: 20, graceHours: 12 },
    minAction: { title: '', durationMin: 20, completionStandard: '' },
  });
  return toDto(joined.experiment, joined.outcomeId, fallback.cadence, fallback.minAction);
}

export async function completeContinuityExperiment(
  userId: string,
  id: string,
  now = new Date(),
): Promise<ContinuityExperiment> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(continuityExperiments)
      .where(and(eq(continuityExperiments.id, id), eq(continuityExperiments.userId, userId)))
      .limit(1)
      .for('update');
    if (!row || row.status !== 'review_ready') throw AppError.of(404, 'NOT_FOUND');
    const [contract] = await tx
      .select({ outcomeId: continuityContracts.outcomeId })
      .from(continuityContracts)
      .where(eq(continuityContracts.id, row.contractId))
      .limit(1);
    if (!contract) throw AppError.of(404, 'NOT_FOUND');
    const [updated] = await tx
      .update(continuityExperiments)
      .set({ status: 'completed', updatedAt: now })
      .where(eq(continuityExperiments.id, row.id))
      .returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    const fallback = parseGoal(updated.goal, {
      cadence: { kind: 'weekly_count', count: 2, durationMin: 20, graceHours: 12 },
      minAction: { title: '', durationMin: 20, completionStandard: '' },
    });
    return toDto(updated, contract.outcomeId, fallback.cadence, fallback.minAction);
  });
}

function computeReview(
  experiment: ContinuityExperimentRow,
  opportunities: readonly Opportunity[],
  links: readonly EvidenceLink[],
  evidence: readonly Evidence[],
  now: Date,
): ContinuityExperimentReview {
  const goal = parseGoal(experiment.goal, {
    cadence: { kind: 'weekly_count', count: 2, durationMin: 20, graceHours: 12 },
    minAction: { title: '', durationMin: 20, completionStandard: '' },
  });
  const windowStart = experiment.windowStart.getTime();
  const windowEnd = experiment.windowEnd.getTime();
  const inWindow = opportunities.filter(
    (row) =>
      row.revision === experiment.afterRevision &&
      row.status !== 'canceled' &&
      row.startsAt.getTime() < windowEnd &&
      row.checkAt.getTime() > windowStart,
  );
  const checked = inWindow.filter(
    (row) => row.status !== 'exempt' && row.checkAt.getTime() <= now.getTime(),
  );
  const windowOppIds = new Set(inWindow.map((row) => row.id));
  const superseded = supersededIdsOf(evidence);
  const counted = new Set<string>();
  for (const link of links) {
    if (!link.meetsCriteria || !link.opportunityId || !windowOppIds.has(link.opportunityId)) continue;
    counted.add(link.evidenceId);
  }
  for (const row of evidence) {
    if (!isProgressEvidence(row, superseded)) continue;
    const t = row.occurredAt.getTime();
    if (t < windowStart || t > windowEnd) continue;
    const bound = row.body.contractId;
    if (typeof bound === 'string' && bound.length > 0 && bound !== experiment.contractId) continue;
    counted.add(row.id);
  }
  const actualProgress = counted.size;
  const insufficientData = checked.length === 0 || actualProgress === 1;
  const metAgreement = insufficientData ? null : actualProgress >= targetOf(goal.cadence);
  return { actualProgress, metAgreement, insufficientData };
}

export async function syncContinuityExperiments(
  tx: AgentJobTransaction,
  input: {
    userId: string;
    contractId: string;
    now: Date;
    opportunities: readonly Opportunity[];
    links: readonly EvidenceLink[];
    evidence: readonly Evidence[];
  },
): Promise<void> {
  const [row] = await tx
    .select()
    .from(continuityExperiments)
    .where(
      and(
        eq(continuityExperiments.contractId, input.contractId),
        eq(continuityExperiments.userId, input.userId),
        inArray(continuityExperiments.status, [...OPEN_STATUSES]),
      ),
    )
    .limit(1)
    .for('update');
  if (!row) return;

  if (row.status === 'active' && row.windowEnd.getTime() <= input.now.getTime()) {
    const review = computeReview(row, input.opportunities, input.links, input.evidence, input.now);
    await tx
      .update(continuityExperiments)
      .set({
        status: 'review_ready',
        review,
        reviewVersion: Math.max(row.reviewVersion, 1),
        updatedAt: input.now,
      })
      .where(eq(continuityExperiments.id, row.id));
    return;
  }

  if (row.status === 'review_ready') {
    const next = computeReview(row, input.opportunities, input.links, input.evidence, input.now);
    const stored = parseReview(row.review);
    if (stored && stored.actualProgress !== next.actualProgress) {
      await tx
        .update(continuityExperiments)
        .set({ reviewVersion: row.reviewVersion + 1, updatedAt: input.now })
        .where(eq(continuityExperiments.id, row.id));
    }
  }
}
