import { and, asc, eq, isNull } from 'drizzle-orm';
import { executionResult } from '../agent/executions.service.js';
import { withAgentJobEffects, type AgentJobTransaction } from '../agent/job-runtime.js';
import {
  continuityContractRevisions,
  continuityContracts,
  continuityEvents,
  continuityEvidence,
  continuityEvidenceLinks,
  continuityOpportunities,
  type AgentJobRow,
  type ContinuityContractRow,
  type ContinuityEventRow,
  type ContinuityOpportunityRow,
  type User,
} from '../db/schema.js';
import { interruptOpenExperiments, syncContinuityExperiments } from './experiments.service.js';
import {
  syncStallIntervention,
  withdrawOpenKind,
  withdrawOpenStallAdjustments,
} from './interventions.service.js';
import { recompute } from './rules/index.js';
import { syncWorkRiskIntervention } from './work-risk-sync.js';
import type {
  Evidence,
  EvidenceActor,
  EvidenceLink,
  EvidenceSourceType,
  Opportunity,
  OpportunityKind,
  OpportunityStatus,
  PauseRange,
} from './rules/types.js';

export {
  CONTINUITY_RECOMPUTE_JOB_TYPE,
  continuityModelEvalDedupKey,
  continuityRecomputeDedupKey,
  enqueueContinuityRecompute,
  enqueueDueContinuityRecomputes,
  tryReserveDailyModelEval,
} from './enqueue.js';

const HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
const LIVE_STATUSES = new Set<OpportunityStatus>(['scheduled', 'open']);

export async function processContinuityRecompute(
  job: AgentJobRow,
  _user: User,
  now: Date,
): Promise<'done'> {
  if (!('contractId' in job.payload) || typeof job.payload.contractId !== 'string') {
    return 'done';
  }
  const contractId = job.payload.contractId;
  if (!contractId) return 'done';

  const applied = await withAgentJobEffects(job, async (tx) =>
    applyContinuityRecompute(tx, job.userId, contractId, now),
  );
  executionResult({
    resultSummary: `已重算 ${String(applied.windowCount)} 个机会窗口`,
    inputSummary: '约定机会与证据归属',
  });
  return 'done';
}

async function applyContinuityRecompute(
  tx: AgentJobTransaction,
  userId: string,
  contractId: string,
  now: Date,
): Promise<{ windowCount: number }> {
  const [contract] = await tx
    .select()
    .from(continuityContracts)
    .where(and(eq(continuityContracts.id, contractId), eq(continuityContracts.userId, userId)))
    .limit(1)
    .for('update');
  if (!contract) {
    await markEventsProcessed(tx, userId, contractId, now);
    return { windowCount: 0 };
  }

  if (contract.lifecycle === 'ended') {
    const existing = await loadOpportunities(tx, contractId);
    const canceled = existing.filter(
      (row) => row.startsAt.getTime() > now.getTime() && LIVE_STATUSES.has(row.status),
    );
    for (const row of canceled) {
      await tx
        .update(continuityOpportunities)
        .set({ status: 'canceled', updatedAt: now })
        .where(eq(continuityOpportunities.id, row.id));
    }
    await tx
      .update(continuityContracts)
      .set({ nextCheckAt: null, updatedAt: now })
      .where(and(eq(continuityContracts.id, contractId), eq(continuityContracts.userId, userId)));
    await withdrawOpenStallAdjustments(tx, contractId, now);
    await withdrawOpenKind(tx, contractId, 'work_risk', now);
    await interruptOpenExperiments(tx, contractId, now);
    await markEventsProcessed(tx, userId, contractId, now);
    return { windowCount: existing.length };
  }

  const [revision] = await tx
    .select()
    .from(continuityContractRevisions)
    .where(
      and(
        eq(continuityContractRevisions.contractId, contractId),
        eq(continuityContractRevisions.revision, contract.currentRevision),
      ),
    )
    .limit(1);
  if (!revision?.activatedAt) {
    await withdrawOpenStallAdjustments(tx, contractId, now);
    await withdrawOpenKind(tx, contractId, 'work_risk', now);
    await markEventsProcessed(tx, userId, contractId, now);
    return { windowCount: 0 };
  }

  const existing = await loadOpportunities(tx, contractId);
  const evidence = await loadEvidence(tx, userId, contractId);
  const events = await tx
    .select()
    .from(continuityEvents)
    .where(eq(continuityEvents.aggregateId, contractId))
    .orderBy(asc(continuityEvents.sequence));
  const pauseRanges = pauseRangesFrom(events, contract);
  const result = recompute({
    revision: {
      revision: revision.revision,
      cadence: revision.cadence,
      timezone: revision.timezone,
      weekStartsOn: revision.weekStartsOn === 0 ? 0 : 1,
      activatedAt: revision.activatedAt,
      userId: contract.userId,
      contractId: contract.id,
    },
    existing,
    evidence,
    pauseRanges,
    now,
    horizonEnd: new Date(now.getTime() + HORIZON_MS),
  });

  await upsertOpportunities(tx, existing, result.opportunities);
  await replaceLinks(tx, contractId, result.links);

  const nextCheckAt = nextCheckAtOf(result.opportunities, now);
  const [updated] = await tx
    .update(continuityContracts)
    .set({
      judgement: result.judgement,
      nextCheckAt,
      updatedAt: now,
    })
    .where(and(eq(continuityContracts.id, contractId), eq(continuityContracts.userId, userId)))
    .returning();
  if (updated) {
    await syncStallIntervention(tx, {
      userId,
      contract: updated,
      revision,
      stall: result.stall,
      opportunities: result.opportunities,
      now,
    });
    await syncWorkRiskIntervention(tx, {
      userId,
      contract: updated,
      revision,
      now,
    });
  }
  if (updated?.lifecycle === 'paused') {
    await interruptOpenExperiments(tx, contractId, now);
  } else {
    await syncContinuityExperiments(tx, {
      userId,
      contractId,
      now,
      opportunities: result.opportunities,
      links: result.links,
      evidence,
    });
  }
  await markEventsProcessed(tx, userId, contractId, now);
  return { windowCount: result.opportunities.length };
}

function nextCheckAtOf(opportunities: readonly Opportunity[], now: Date): Date | null {
  let next: Date | null = null;
  for (const row of opportunities) {
    if (!LIVE_STATUSES.has(row.status)) continue;
    if (row.checkAt.getTime() < now.getTime()) continue;
    if (!next || row.checkAt.getTime() < next.getTime()) next = row.checkAt;
  }
  return next;
}

function pauseRangesFrom(
  events: readonly ContinuityEventRow[],
  contract: ContinuityContractRow,
): PauseRange[] {
  const ranges: PauseRange[] = [];
  let openStart: Date | null = null;
  let openUntil: Date | null = null;
  for (const event of events) {
    if (event.type === 'contract.paused') {
      if (openStart) ranges.push({ start: openStart, end: event.createdAt });
      openStart = event.createdAt;
      openUntil = untilFromPayload(event.payload);
    } else if (event.type === 'contract.resumed' && openStart) {
      ranges.push({ start: openStart, end: event.createdAt });
      openStart = null;
      openUntil = null;
    }
  }
  if (openStart) {
    ranges.push({ start: openStart, end: openUntil });
  } else if (contract.lifecycle === 'paused') {
    ranges.push({ start: contract.updatedAt, end: contract.pausedUntil });
  }
  return ranges;
}

function untilFromPayload(payload: Record<string, unknown>): Date | null {
  const until = payload.until;
  if (typeof until !== 'string' || until.length === 0) return null;
  const date = new Date(until);
  return Number.isNaN(+date) ? null : date;
}

async function loadOpportunities(tx: AgentJobTransaction, contractId: string): Promise<Opportunity[]> {
  const rows = await tx
    .select()
    .from(continuityOpportunities)
    .where(eq(continuityOpportunities.contractId, contractId));
  return rows.map(opportunityFromRow);
}

async function loadEvidence(
  tx: AgentJobTransaction,
  userId: string,
  contractId: string,
): Promise<Evidence[]> {
  const rows = await tx
    .select()
    .from(continuityEvidence)
    .where(eq(continuityEvidence.userId, userId));
  if (rows.length === 0) return [];
  const links = await tx
    .select()
    .from(continuityEvidenceLinks)
    .where(eq(continuityEvidenceLinks.contractId, contractId));
  const oppByEvidence = new Map(
    links.map((link) => [link.evidenceId, link.opportunityId ?? undefined]),
  );
  const linkedIds = new Set(links.map((link) => link.evidenceId));
  return rows
    .filter((row) => evidenceBelongsToContract(row.id, row.body, contractId, linkedIds))
    .map((row) => {
      const opportunityId = oppByEvidence.get(row.id);
      return {
        id: row.id,
        userId: row.userId,
        sourceType: row.sourceType as EvidenceSourceType,
        sourceId: row.sourceId,
        sourceRevision: row.sourceRevision,
        actor: row.actor as EvidenceActor,
        occurredAt: row.occurredAt,
        recordedAt: row.recordedAt,
        body: row.body,
        supersedesId: row.supersedesId,
        retractedAt: row.retractedAt,
        idempotencyKey: row.idempotencyKey,
        ...(opportunityId ? { opportunityId } : {}),
      };
    });
}

function evidenceBelongsToContract(
  evidenceId: string,
  body: Record<string, unknown>,
  contractId: string,
  linkedIds: Set<string>,
): boolean {
  if (linkedIds.has(evidenceId)) return true;
  const bound = body.contractId;
  if (typeof bound === 'string' && bound.length > 0) return bound === contractId;
  return true;
}

function opportunityFromRow(row: ContinuityOpportunityRow): Opportunity {
  return {
    id: row.id,
    userId: row.userId,
    contractId: row.contractId,
    revision: row.revision,
    kind: row.kind as OpportunityKind,
    windowKey: row.windowKey,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    checkAt: row.checkAt,
    localStartDate: row.localStartDate,
    localEndDate: row.localEndDate,
    timezoneSnapshot: row.timezoneSnapshot,
    targetCount: row.targetCount,
    status: row.status as OpportunityStatus,
    exemptReason: row.exemptReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    observeOnly: false,
  };
}

function opportunityValues(row: Opportunity) {
  return {
    id: row.id,
    userId: row.userId,
    contractId: row.contractId,
    revision: row.revision,
    kind: row.kind,
    windowKey: row.windowKey,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    checkAt: row.checkAt,
    localStartDate: row.localStartDate,
    localEndDate: row.localEndDate,
    timezoneSnapshot: row.timezoneSnapshot,
    targetCount: row.targetCount,
    status: row.status,
    exemptReason: row.exemptReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function upsertOpportunities(
  tx: AgentJobTransaction,
  existing: readonly Opportunity[],
  next: readonly Opportunity[],
): Promise<void> {
  const existingKeys = new Set(existing.map((row) => `${String(row.revision)}\0${row.windowKey}`));
  const inserts: Opportunity[] = [];
  const updates: Opportunity[] = [];
  for (const row of next) {
    if (existingKeys.has(`${String(row.revision)}\0${row.windowKey}`)) updates.push(row);
    else inserts.push(row);
  }
  if (inserts.length > 0) {
    await tx.insert(continuityOpportunities).values(inserts.map(opportunityValues));
  }
  for (const row of updates) {
    await tx
      .update(continuityOpportunities)
      .set({
        kind: row.kind,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        checkAt: row.checkAt,
        localStartDate: row.localStartDate,
        localEndDate: row.localEndDate,
        timezoneSnapshot: row.timezoneSnapshot,
        targetCount: row.targetCount,
        status: row.status,
        exemptReason: row.exemptReason,
        updatedAt: row.updatedAt,
      })
      .where(
        and(
          eq(continuityOpportunities.contractId, row.contractId),
          eq(continuityOpportunities.revision, row.revision),
          eq(continuityOpportunities.windowKey, row.windowKey),
        ),
      );
  }
}

async function replaceLinks(
  tx: AgentJobTransaction,
  contractId: string,
  links: readonly EvidenceLink[],
): Promise<void> {
  await tx.delete(continuityEvidenceLinks).where(eq(continuityEvidenceLinks.contractId, contractId));
  if (links.length === 0) return;
  await tx.insert(continuityEvidenceLinks).values(
    links.map((row) => ({
      id: row.id,
      userId: row.userId,
      evidenceId: row.evidenceId,
      contractId: row.contractId,
      opportunityId: row.opportunityId,
      meetsCriteria: row.meetsCriteria,
      rationale: row.rationale,
      createdAt: row.createdAt,
    })),
  );
}

async function markEventsProcessed(
  tx: AgentJobTransaction,
  userId: string,
  contractId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(continuityEvents)
    .set({ processedAt: now })
    .where(
      and(
        eq(continuityEvents.userId, userId),
        eq(continuityEvents.aggregateId, contractId),
        isNull(continuityEvents.processedAt),
      ),
    );
}
