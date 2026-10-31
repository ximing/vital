import { createHash, randomUUID } from 'node:crypto';
import type {
  ContinuityFeedbackInput,
  ContinuityIntervention,
  ContinuityInterventionContent,
  ContinuityInterventionList,
  ContinuityMinAction,
  ContinuitySnoozeInput,
} from '@vital/dto';
import { continuityInterventionContentSchema } from '@vital/dto';
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  continuityContracts,
  continuityExposures,
  continuityInterventions,
  type ContinuityContractRevisionRow,
  type ContinuityContractRow,
  type ContinuityInterventionRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import {
  cancelPendingContinuityPush,
  maybeEnqueueContinuityPush,
  type ContinuityTx,
} from './delivery-policy.js';
import { occurredAtForDone, recordSelfReportInTx } from './evidence.service.js';
import { startContinuityExperimentInTx } from './experiments.service.js';
import type { Opportunity, StallDecision } from './rules/types.js';

const OPEN_STATUSES = ['open', 'snoozed'] as const;
const STALL_KIND = 'stall_adjust' as const;
const CANDIDATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SNOOZE_DEFAULT_MS = 3 * 24 * 60 * 60 * 1000;
const IN_APP_ONLY_MS = 14 * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 3;

const SECONDARY_ACTIONS: ContinuityInterventionContent['secondaryActions'] = [
  { kind: 'log', title: '补记已经做过' },
  { kind: 'snooze', title: '晚点再说' },
  { kind: 'pause', title: '暂停跟进' },
];

export function stallFactFingerprint(opportunityIds: readonly string[], revision: number): string {
  const material = `${[...opportunityIds].sort().join(',')}:${String(revision)}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function parseInterventionContent(raw: unknown): ContinuityInterventionContent {
  const parsed = continuityInterventionContentSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return {
    facts: [],
    whyNow: '约定时段没有记录，可以补记、做一次最小行动，或调整约定。',
    primaryAction: { title: '做一次最小行动', durationMin: 10, completionStandard: '' },
    secondaryActions: SECONDARY_ACTIONS,
  };
}

function monthDayLabel(ymd: string): string {
  const parts = ymd.split('-');
  const month = Number(parts[1] ?? '1');
  const day = Number(parts[2] ?? '1');
  return `${String(month)}月${String(day)}日`;
}

function factSentence(row: Opportunity): string {
  const label = monthDayLabel(row.localStartDate);
  if (row.kind === 'weekly_count') return `${label}那一周没有记录`;
  return `${label}约定时段没有记录`;
}

function whyNowFor(opportunities: readonly Opportunity[]): string {
  if (opportunities.some((row) => row.kind === 'weekly_count')) {
    return '这个周期约定次数没有记录，可以补记、做一次最小行动，或调整约定。';
  }
  return '约定时段没有记录，可以补记、做一次最小行动，或调整约定。';
}

function primaryActionOf(minAction: ContinuityMinAction): ContinuityMinAction {
  const title = minAction.title.trim();
  return {
    title: title.length > 0 ? title : '做一次最小行动',
    durationMin: minAction.durationMin,
    completionStandard: minAction.completionStandard,
  };
}

function stallContent(
  stall: StallDecision,
  opportunities: readonly Opportunity[],
  minAction: ContinuityMinAction,
): ContinuityInterventionContent {
  const byId = new Map(opportunities.map((row) => [row.id, row]));
  const facts = stall.factRefs.opportunityIds
    .map((id) => byId.get(id))
    .filter((row): row is Opportunity => Boolean(row))
    .map(factSentence);
  const used = facts.length > 0 ? facts : ['没有记录'];
  const refs = stall.factRefs.opportunityIds
    .map((id) => byId.get(id))
    .filter((row): row is Opportunity => Boolean(row));
  return {
    facts: used,
    whyNow: whyNowFor(refs),
    primaryAction: primaryActionOf(minAction),
    secondaryActions: SECONDARY_ACTIONS,
  };
}

function toDto(row: ContinuityInterventionRow, outcomeId: string): ContinuityIntervention {
  return {
    id: row.id,
    contractId: row.contractId,
    outcomeId,
    revision: row.revision,
    kind: row.kind as ContinuityIntervention['kind'],
    factFingerprint: row.factFingerprint,
    status: row.status as ContinuityIntervention['status'],
    expiresAt: iso(row.expiresAt),
    actionableUntil: iso(row.actionableUntil),
    snoozedUntil: iso(row.snoozedUntil),
    content: parseInterventionContent(row.content),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function withdrawInterventionRows(
  tx: ContinuityTx,
  rows: readonly ContinuityInterventionRow[],
  now: Date,
): Promise<void> {
  for (const row of rows) {
    await tx
      .update(continuityInterventions)
      .set({ status: 'withdrawn', updatedAt: now })
      .where(eq(continuityInterventions.id, row.id));
    await cancelPendingContinuityPush(tx, row.id, now, 'candidate withdrawn');
  }
}

async function expireOpenStallAdjustments(
  tx: ContinuityTx,
  contract: ContinuityContractRow,
  now: Date,
): Promise<void> {
  const stale = await tx
    .select()
    .from(continuityInterventions)
    .where(
      and(
        eq(continuityInterventions.contractId, contract.id),
        eq(continuityInterventions.kind, STALL_KIND),
        inArray(continuityInterventions.status, [...OPEN_STATUSES]),
        eq(continuityInterventions.userId, contract.userId),
      ),
    );
  const expired = stale.filter((row) => row.expiresAt && row.expiresAt.getTime() <= now.getTime());
  if (expired.length === 0) return;

  let unanswered = contract.unansweredStreak;
  let inAppOnlyUntil = contract.inAppOnlyUntil;
  for (const row of expired) {
    await tx
      .update(continuityInterventions)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(continuityInterventions.id, row.id));
    await cancelPendingContinuityPush(tx, row.id, now, 'candidate expired');
    const exposures = await tx
      .select({ handledAt: continuityExposures.handledAt })
      .from(continuityExposures)
      .where(eq(continuityExposures.candidateId, row.id));
    if (exposures.some((item) => item.handledAt)) continue;
    unanswered += 1;
    if (unanswered >= 2) inAppOnlyUntil = new Date(now.getTime() + IN_APP_ONLY_MS);
  }
  if (unanswered !== contract.unansweredStreak || inAppOnlyUntil !== contract.inAppOnlyUntil) {
    await tx
      .update(continuityContracts)
      .set({ unansweredStreak: unanswered, inAppOnlyUntil, updatedAt: now })
      .where(
        and(eq(continuityContracts.id, contract.id), eq(continuityContracts.userId, contract.userId)),
      );
  }
}

export async function withdrawOpenKind(
  tx: ContinuityTx,
  contractId: string,
  kind: ContinuityInterventionRow['kind'],
  now: Date,
): Promise<void> {
  const rows = await tx
    .select()
    .from(continuityInterventions)
    .where(
      and(
        eq(continuityInterventions.contractId, contractId),
        eq(continuityInterventions.kind, kind),
        inArray(continuityInterventions.status, [...OPEN_STATUSES]),
      ),
    );
  await withdrawInterventionRows(tx, rows, now);
}

export async function withdrawOpenStallAdjustments(
  tx: ContinuityTx,
  contractId: string,
  now: Date,
): Promise<void> {
  await withdrawOpenKind(tx, contractId, STALL_KIND, now);
}

export async function syncStallIntervention(
  tx: ContinuityTx,
  input: {
    userId: string;
    contract: ContinuityContractRow;
    revision: ContinuityContractRevisionRow;
    stall: StallDecision;
    opportunities: readonly Opportunity[];
    now: Date;
  },
): Promise<ContinuityInterventionRow | null> {
  const { contract, revision, stall, opportunities, now } = input;
  await expireOpenStallAdjustments(tx, contract, now);

  const openRows = await tx
    .select()
    .from(continuityInterventions)
    .where(
      and(
        eq(continuityInterventions.contractId, contract.id),
        eq(continuityInterventions.kind, STALL_KIND),
        inArray(continuityInterventions.status, [...OPEN_STATUSES]),
      ),
    );

  if (stall.kind !== 'stall') {
    await withdrawInterventionRows(tx, openRows, now);
    return null;
  }

  const fingerprint = stallFactFingerprint(stall.factRefs.opportunityIds, revision.revision);
  const content = stallContent(stall, opportunities, revision.minAction);
  const same = openRows.filter(
    (row) => row.factFingerprint === fingerprint && row.revision === revision.revision,
  );
  const others = openRows.filter((row) => !same.includes(row));
  await withdrawInterventionRows(tx, others, now);

  const existing = same[0];
  if (existing) {
    const [updated] = await tx
      .update(continuityInterventions)
      .set({ content, updatedAt: now })
      .where(eq(continuityInterventions.id, existing.id))
      .returning();
    const row = updated ?? existing;
    await maybeEnqueueContinuityPush(tx, {
      userId: input.userId,
      contract,
      intervention: row,
      message: content.whyNow,
      now,
    });
    return row;
  }

  const [expiredSame] = await tx
    .select({ id: continuityInterventions.id })
    .from(continuityInterventions)
    .where(
      and(
        eq(continuityInterventions.contractId, contract.id),
        eq(continuityInterventions.kind, STALL_KIND),
        eq(continuityInterventions.factFingerprint, fingerprint),
        eq(continuityInterventions.revision, revision.revision),
        eq(continuityInterventions.status, 'expired'),
      ),
    )
    .limit(1);
  if (expiredSame) return null;

  const [inserted] = await tx
    .insert(continuityInterventions)
    .values({
      id: randomUUID(),
      userId: input.userId,
      contractId: contract.id,
      revision: revision.revision,
      kind: STALL_KIND,
      factFingerprint: fingerprint,
      status: 'open',
      expiresAt: new Date(now.getTime() + CANDIDATE_TTL_MS),
      content,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!inserted) return null;
  await maybeEnqueueContinuityPush(tx, {
    userId: input.userId,
    contract,
    intervention: inserted,
    message: content.whyNow,
    now,
  });
  return inserted;
}

export async function listContinuityInterventions(
  userId: string,
  now = new Date(),
): Promise<ContinuityInterventionList> {
  const rows = await getDb()
    .select({
      intervention: continuityInterventions,
      outcomeId: continuityContracts.outcomeId,
    })
    .from(continuityInterventions)
    .innerJoin(
      continuityContracts,
      eq(continuityContracts.id, continuityInterventions.contractId),
    )
    .where(
      and(
        eq(continuityInterventions.userId, userId),
        inArray(continuityInterventions.status, [...OPEN_STATUSES]),
        or(
          isNull(continuityInterventions.expiresAt),
          gt(continuityInterventions.expiresAt, now),
        ),
      ),
    )
    .orderBy(desc(continuityInterventions.createdAt));
  const rank: Record<string, number> = {
    work_risk: 0,
    stall_adjust: 1,
    explore: 2,
    experiment_review: 3,
  };
  const sorted = [...rows].sort((a, b) => {
    const ra = rank[a.intervention.kind] ?? 9;
    const rb = rank[b.intervention.kind] ?? 9;
    if (ra !== rb) return ra - rb;
    return b.intervention.createdAt.getTime() - a.intervention.createdAt.getTime();
  });
  return { items: sorted.slice(0, LIST_LIMIT).map((row) => toDto(row.intervention, row.outcomeId)) };
}

async function loadOwnedIntervention(
  tx: ContinuityTx,
  userId: string,
  id: string,
): Promise<{ row: ContinuityInterventionRow; outcomeId: string }> {
  const [joined] = await tx
    .select({
      intervention: continuityInterventions,
      outcomeId: continuityContracts.outcomeId,
    })
    .from(continuityInterventions)
    .innerJoin(
      continuityContracts,
      eq(continuityContracts.id, continuityInterventions.contractId),
    )
    .where(and(eq(continuityInterventions.id, id), eq(continuityInterventions.userId, userId)))
    .limit(1);
  if (!joined) throw AppError.of(404, 'NOT_FOUND');
  return { row: joined.intervention, outcomeId: joined.outcomeId };
}

async function markHandled(
  tx: ContinuityTx,
  userId: string,
  candidateId: string,
  now: Date,
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(continuityExposures)
    .where(
      and(
        eq(continuityExposures.userId, userId),
        eq(continuityExposures.candidateId, candidateId),
        eq(continuityExposures.surface, 'today'),
      ),
    )
    .limit(1)
    .for('update');
  if (existing) {
    await tx
      .update(continuityExposures)
      .set({ handledAt: existing.handledAt ?? now, seenAt: existing.seenAt ?? now })
      .where(eq(continuityExposures.id, existing.id));
    return;
  }
  await tx.insert(continuityExposures).values({
    id: randomUUID(),
    userId,
    candidateId,
    surface: 'today',
    seenAt: now,
    handledAt: now,
    reservedAt: now,
    budgetClass: 'ordinary',
    periodKey: `d:${now.toISOString().slice(0, 10)}`,
    createdAt: now,
  });
}

async function resetUnanswered(tx: ContinuityTx, contractId: string, userId: string, now: Date) {
  await tx
    .update(continuityContracts)
    .set({ unansweredStreak: 0, updatedAt: now })
    .where(and(eq(continuityContracts.id, contractId), eq(continuityContracts.userId, userId)));
}

export async function markContinuityInterventionSeen(
  userId: string,
  id: string,
  now = new Date(),
): Promise<ContinuityIntervention> {
  return getDb().transaction(async (tx) => {
    const { row, outcomeId } = await loadOwnedIntervention(tx, userId, id);
    const [existing] = await tx
      .select()
      .from(continuityExposures)
      .where(
        and(
          eq(continuityExposures.userId, userId),
          eq(continuityExposures.candidateId, row.id),
          eq(continuityExposures.surface, 'today'),
        ),
      )
      .limit(1)
      .for('update');
    if (existing) {
      if (!existing.seenAt) {
        await tx
          .update(continuityExposures)
          .set({ seenAt: now })
          .where(eq(continuityExposures.id, existing.id));
      }
    } else {
      await tx.insert(continuityExposures).values({
        id: randomUUID(),
        userId,
        candidateId: row.id,
        surface: 'today',
        seenAt: now,
        reservedAt: now,
        budgetClass: 'ordinary',
        periodKey: `d:${now.toISOString().slice(0, 10)}`,
        createdAt: now,
      });
    }
    await cancelPendingContinuityPush(tx, row.id, now, 'seen in app');
    return toDto(row, outcomeId);
  });
}

export async function snoozeContinuityIntervention(
  userId: string,
  id: string,
  input: ContinuitySnoozeInput,
  now = new Date(),
): Promise<ContinuityIntervention> {
  return getDb().transaction(async (tx) => {
    const { row, outcomeId } = await loadOwnedIntervention(tx, userId, id);
    if (row.status !== 'open' && row.status !== 'snoozed') {
      throw AppError.of(404, 'NOT_FOUND');
    }
    const until = input.until ? new Date(input.until) : new Date(now.getTime() + SNOOZE_DEFAULT_MS);
    const [updated] = await tx
      .update(continuityInterventions)
      .set({ status: 'snoozed', snoozedUntil: until, updatedAt: now })
      .where(eq(continuityInterventions.id, row.id))
      .returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    await cancelPendingContinuityPush(tx, row.id, now, 'candidate snoozed');
    return toDto(updated, outcomeId);
  });
}

export async function feedbackContinuityIntervention(
  userId: string,
  id: string,
  input: ContinuityFeedbackInput,
  now = new Date(),
): Promise<ContinuityIntervention> {
  const result = await getDb().transaction(async (tx) => {
    const { row, outcomeId } = await loadOwnedIntervention(tx, userId, id);
    if (row.status !== 'open' && row.status !== 'snoozed') {
      throw AppError.of(404, 'NOT_FOUND');
    }
    if (input.kind === 'done') {
      const occurredAt = input.occurredAt
        ? new Date(input.occurredAt)
        : await occurredAtForDone(tx, row.contractId, now);
      await recordSelfReportInTx(tx, {
        userId,
        contractId: row.contractId,
        ...(input.body !== undefined ? { body: input.body } : {}),
        occurredAt,
        now,
        idempotencyKey: `intervention.done:${row.id}`,
        sourceId: row.id,
        sourceRevision: 0,
      });
    }
    if (input.kind === 'adjust') {
      await startContinuityExperimentInTx(tx, {
        userId,
        contractId: row.contractId,
        ...(input.hypothesis !== undefined ? { hypothesis: input.hypothesis } : {}),
        ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
        ...(input.minAction !== undefined ? { minAction: input.minAction } : {}),
        now,
        supersede: true,
      });
    }
    const nextStatus =
      input.kind === 'done' ? 'resolved' : input.kind === 'adjust' ? 'accepted' : 'dismissed';
    const [updated] = await tx
      .update(continuityInterventions)
      .set({ status: nextStatus, updatedAt: now })
      .where(eq(continuityInterventions.id, row.id))
      .returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    await markHandled(tx, userId, row.id, now);
    await resetUnanswered(tx, row.contractId, userId, now);
    await cancelPendingContinuityPush(tx, row.id, now, 'candidate handled');
    return { dto: toDto(updated, outcomeId), outcomeId, pause: input.kind === 'pause' };
  });
  if (result.pause) {
    const { pauseContinuity } = await import('./continuity.service.js');
    await pauseContinuity(userId, result.outcomeId, {});
  }
  return result.dto;
}
