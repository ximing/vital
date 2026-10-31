import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type {
  ContinuityActivateInput,
  ContinuityAuthorization,
  ContinuityCadence,
  ContinuityContractSummary,
  ContinuityDraftInput,
  ContinuityGetResponse,
  ContinuityMinAction,
  ContinuityPauseInput,
  ContinuitySettings,
  ContinuityVersionInput,
  PutContinuitySettingsInput,
} from '@vital/dto';
import {
  DEFAULT_CONTINUITY_AUTHORIZATION,
  DEFAULT_CONTINUITY_CADENCE,
} from '@vital/dto';
import type { AgentJobTransaction } from '../agent/job-runtime.js';
import { getUserEntity } from '../auth/auth.service.js';
import { isUniqueViolation } from '../db/pg.js';
import { getDb } from '../db/index.js';
import {
  continuityContractRevisions,
  continuityContracts,
  continuityEvents,
  continuityUserSettings,
  type ContinuityContractRevisionRow,
  type ContinuityContractRow,
  type User,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getOwnedOutcomeOr404 } from '../outcomes/shared.js';
import { enqueueContinuityRecompute } from './enqueue.js';
import { isContinuityEnabled } from './flag.js';

const DEFAULT_SETTINGS: ContinuitySettings = {
  explorationWeekend: false,
  explorationHoliday: false,
  region: null,
  externalSearch: false,
  dailyPushLimit: 1,
  weeklyPushLimit: 3,
  defaultCadence: null,
};

type RevisionFields = {
  meaning: string;
  stageGoal: string;
  completionCriteria: string[];
  cadence: ContinuityCadence;
  timezone: string;
  weekStartsOn: 0 | 1;
  minAction: ContinuityMinAction;
  evidenceBindings: unknown[];
  actionableWindows: unknown[];
  authorization: ContinuityAuthorization;
  concernRefs: unknown[];
};

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function weekStartsOnOf(value: number): 0 | 1 {
  return value === 0 ? 0 : 1;
}

function assertWritesEnabled(): void {
  if (!isContinuityEnabled()) throw AppError.of(403, 'CONTINUITY_DISABLED');
}

function assertExpectedVersion(current: number, expected?: number): void {
  if (expected === undefined) return;
  if (expected !== current) {
    throw AppError.of(409, 'CONTINUITY_VERSION_CONFLICT', { currentVersion: current });
  }
}

function durationMinOf(cadence: ContinuityCadence): number {
  if (cadence.kind === 'weekly_count') return cadence.durationMin;
  return cadence.slots[0]?.durationMin ?? 20;
}

function defaultMinAction(cadence: ContinuityCadence): ContinuityMinAction {
  return { title: '', durationMin: durationMinOf(cadence), completionStandard: '' };
}

function fieldsFromRevision(row: ContinuityContractRevisionRow): RevisionFields {
  return {
    meaning: row.meaning,
    stageGoal: row.stageGoal,
    completionCriteria: row.completionCriteria,
    cadence: row.cadence,
    timezone: row.timezone,
    weekStartsOn: weekStartsOnOf(row.weekStartsOn),
    minAction: row.minAction,
    evidenceBindings: row.evidenceBindings,
    actionableWindows: row.actionableWindows,
    authorization: row.authorization,
    concernRefs: row.concernRefs,
  };
}

function resolveDraft(
  input: ContinuityDraftInput,
  user: User,
  previous: RevisionFields | null,
): RevisionFields {
  const cadence = input.cadence ?? previous?.cadence ?? DEFAULT_CONTINUITY_CADENCE;
  return {
    meaning: input.meaning ?? previous?.meaning ?? '',
    stageGoal: input.stageGoal ?? previous?.stageGoal ?? '',
    completionCriteria: input.completionCriteria ?? previous?.completionCriteria ?? [],
    cadence,
    timezone: input.timezone ?? previous?.timezone ?? user.timezone,
    weekStartsOn: input.weekStartsOn ?? previous?.weekStartsOn ?? weekStartsOnOf(user.weekStartsOn),
    minAction: input.minAction ?? previous?.minAction ?? defaultMinAction(cadence),
    evidenceBindings: input.evidenceBindings ?? previous?.evidenceBindings ?? [],
    actionableWindows: input.actionableWindows ?? previous?.actionableWindows ?? [],
    authorization: input.authorization ?? previous?.authorization ?? DEFAULT_CONTINUITY_AUTHORIZATION,
    concernRefs: input.concernRefs ?? previous?.concernRefs ?? [],
  };
}

function toSummary(
  contract: ContinuityContractRow,
  revision: ContinuityContractRevisionRow | null,
  fallback: RevisionFields,
): ContinuityContractSummary {
  const fields = revision ? fieldsFromRevision(revision) : fallback;
  return {
    id: contract.id,
    outcomeId: contract.outcomeId,
    lifecycle: contract.lifecycle,
    judgement: contract.judgement,
    currentRevision: contract.currentRevision,
    authorizationVersion: contract.authorizationVersion,
    factsVersion: contract.factsVersion,
    nextCheckAt: iso(contract.nextCheckAt),
    pausedUntil: iso(contract.pausedUntil),
    inAppOnlyUntil: iso(contract.inAppOnlyUntil),
    unansweredStreak: contract.unansweredStreak,
    ...fields,
    activatedAt: iso(revision?.activatedAt ?? null),
    createdAt: contract.createdAt.toISOString(),
    updatedAt: contract.updatedAt.toISOString(),
  };
}

function hostedOf(lifecycle: ContinuityContractRow['lifecycle']): boolean {
  return lifecycle === 'active';
}

function responseOf(
  contract: ContinuityContractRow,
  revision: ContinuityContractRevisionRow | null,
  fallback: RevisionFields,
): ContinuityGetResponse {
  return { hosted: hostedOf(contract.lifecycle), contract: toSummary(contract, revision, fallback) };
}

async function loadRevision(
  tx: Pick<ReturnType<typeof getDb>, 'select'>,
  contractId: string,
  revision: number,
): Promise<ContinuityContractRevisionRow | null> {
  if (revision <= 0) return null;
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
  return row ?? null;
}

async function loadContract(
  tx: Pick<ReturnType<typeof getDb>, 'select'>,
  userId: string,
  outcomeId: string,
  forUpdate: boolean,
): Promise<ContinuityContractRow | null> {
  const base = tx
    .select()
    .from(continuityContracts)
    .where(and(eq(continuityContracts.userId, userId), eq(continuityContracts.outcomeId, outcomeId)))
    .limit(1);
  const [row] = forUpdate ? await base.for('update') : await base;
  return row ?? null;
}

export async function insertContinuityEvent(
  tx: Pick<ReturnType<typeof getDb>, 'select' | 'insert'>,
  userId: string,
  aggregateId: string,
  type: string,
  payload: Record<string, unknown>,
  now: Date,
): Promise<void> {
  const [last] = await tx
    .select({ sequence: continuityEvents.sequence })
    .from(continuityEvents)
    .where(eq(continuityEvents.aggregateId, aggregateId))
    .orderBy(desc(continuityEvents.sequence))
    .limit(1);
  await tx.insert(continuityEvents).values({
    id: randomUUID(),
    userId,
    aggregateId,
    sequence: (last?.sequence ?? 0) + 1,
    type,
    payload,
    createdAt: now,
  });
}

async function findRevisionByIdempotency(
  tx: Pick<ReturnType<typeof getDb>, 'select'>,
  userId: string,
  key: string,
): Promise<ContinuityContractRevisionRow | null> {
  const [row] = await tx
    .select()
    .from(continuityContractRevisions)
    .where(
      and(
        eq(continuityContractRevisions.userId, userId),
        eq(continuityContractRevisions.idempotencyKey, key),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function contractById(
  tx: Pick<ReturnType<typeof getDb>, 'select'>,
  userId: string,
  contractId: string,
): Promise<ContinuityContractRow | null> {
  const [row] = await tx
    .select()
    .from(continuityContracts)
    .where(and(eq(continuityContracts.id, contractId), eq(continuityContracts.userId, userId)))
    .limit(1);
  return row ?? null;
}

function emptyFallback(user: User): RevisionFields {
  return resolveDraft({}, user, null);
}

export async function getContinuity(userId: string, outcomeId: string): Promise<ContinuityGetResponse> {
  const outcome = await getOwnedOutcomeOr404(userId, outcomeId);
  const user = await getUserEntity(userId);
  const db = getDb();
  const contract = await loadContract(db, userId, outcome.id, false);
  if (!contract) return { hosted: false, contract: null };
  const revision = await loadRevision(db, contract.id, contract.currentRevision);
  return responseOf(contract, revision, emptyFallback(user));
}

async function replayIdempotency(
  userId: string,
  outcomeId: string,
  key: string | undefined,
  user: User,
  requireActivated: boolean,
): Promise<ContinuityGetResponse | null> {
  if (!key) return null;
  const prior = await findRevisionByIdempotency(getDb(), userId, key);
  if (!prior) return null;
  if (requireActivated && !prior.activatedAt) return null;
  const existing = await contractById(getDb(), userId, prior.contractId);
  if (!existing) return null;
  if (existing.outcomeId !== outcomeId) {
    throw AppError.of(409, 'CONTINUITY_VERSION_CONFLICT', {
      currentVersion: existing.currentRevision,
    });
  }
  const revision = await loadRevision(getDb(), existing.id, existing.currentRevision);
  return responseOf(existing, revision, emptyFallback(user));
}

function revisionValues(
  userId: string,
  contractId: string,
  nextRevision: number,
  fields: RevisionFields,
  idempotencyKey: string | null,
  activatedAt: Date | null,
  now: Date,
) {
  return {
    id: randomUUID(),
    userId,
    contractId,
    revision: nextRevision,
    meaning: fields.meaning,
    stageGoal: fields.stageGoal,
    completionCriteria: fields.completionCriteria,
    cadence: fields.cadence,
    timezone: fields.timezone,
    weekStartsOn: fields.weekStartsOn,
    minAction: fields.minAction,
    evidenceBindings: fields.evidenceBindings,
    actionableWindows: fields.actionableWindows,
    authorization: fields.authorization,
    concernRefs: fields.concernRefs,
    idempotencyKey,
    activatedAt,
    createdAt: now,
  };
}

export async function putContinuityDraft(
  userId: string,
  outcomeId: string,
  input: ContinuityDraftInput,
  now = new Date(),
): Promise<ContinuityGetResponse> {
  assertWritesEnabled();
  const outcome = await getOwnedOutcomeOr404(userId, outcomeId);
  const user = await getUserEntity(userId);
  const replayed = await replayIdempotency(userId, outcome.id, input.idempotencyKey, user, false);
  if (replayed) return replayed;
  try {
    return await getDb().transaction(async (tx) => {
      const contract = await loadContract(tx, userId, outcome.id, true);
      assertExpectedVersion(contract?.currentRevision ?? 0, input.expectedVersion);
      const previous = contract
        ? await loadRevision(tx, contract.id, contract.currentRevision)
        : null;
      const fields = resolveDraft(input, user, previous ? fieldsFromRevision(previous) : null);
      const nextRevision = (contract?.currentRevision ?? 0) + 1;
      let saved: ContinuityContractRow;
      if (!contract) {
        const [inserted] = await tx
          .insert(continuityContracts)
          .values({
            id: randomUUID(),
            userId,
            outcomeId: outcome.id,
            lifecycle: 'draft',
            currentRevision: nextRevision,
            authorizationVersion: nextRevision,
            factsVersion: 0,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!inserted) throw new Error('continuity contract missing after insert');
        saved = inserted;
      } else {
        const [updated] = await tx
          .update(continuityContracts)
          .set({
            currentRevision: nextRevision,
            authorizationVersion: nextRevision,
            updatedAt: now,
          })
          .where(and(eq(continuityContracts.id, contract.id), eq(continuityContracts.userId, userId)))
          .returning();
        if (!updated) throw new Error('continuity contract missing after update');
        saved = updated;
      }
      const key =
        input.idempotencyKey && previous?.idempotencyKey === input.idempotencyKey
          ? null
          : (input.idempotencyKey ?? null);
      const [revision] = await tx
        .insert(continuityContractRevisions)
        .values(revisionValues(userId, saved.id, nextRevision, fields, key, null, now))
        .returning();
      if (!revision) throw new Error('continuity revision missing after insert');
      await insertContinuityEvent(
        tx,
        userId,
        saved.id,
        'contract.draft_saved',
        { outcomeId: outcome.id, revision: nextRevision },
        now,
      );
      return responseOf(saved, revision, fields);
    });
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const replayedAfter = await replayIdempotency(
        userId,
        outcome.id,
        input.idempotencyKey,
        user,
        false,
      );
      if (replayedAfter) return replayedAfter;
    }
    throw err;
  }
}

export async function activateContinuity(
  userId: string,
  outcomeId: string,
  input: ContinuityActivateInput,
  now = new Date(),
): Promise<ContinuityGetResponse> {
  assertWritesEnabled();
  const outcome = await getOwnedOutcomeOr404(userId, outcomeId);
  const user = await getUserEntity(userId);
  const replayed = await replayIdempotency(userId, outcome.id, input.idempotencyKey, user, true);
  if (replayed) return replayed;
  try {
    return await getDb().transaction(async (tx) => {
      const contract = await loadContract(tx, userId, outcome.id, true);
      if (contract?.lifecycle === 'active') {
        const revision = await loadRevision(tx, contract.id, contract.currentRevision);
        return responseOf(contract, revision, emptyFallback(user));
      }
      assertExpectedVersion(contract?.currentRevision ?? 0, input.expectedVersion);
      const previous = contract
        ? await loadRevision(tx, contract.id, contract.currentRevision)
        : null;
      const fields = resolveDraft(input, user, previous ? fieldsFromRevision(previous) : null);
      const nextRevision = (contract?.currentRevision ?? 0) + 1;
      const nextFacts = (contract?.factsVersion ?? 0) + 1;
      let saved: ContinuityContractRow;
      if (!contract) {
        const [inserted] = await tx
          .insert(continuityContracts)
          .values({
            id: randomUUID(),
            userId,
            outcomeId: outcome.id,
            lifecycle: 'active',
            currentRevision: nextRevision,
            authorizationVersion: nextRevision,
            factsVersion: nextFacts,
            pausedUntil: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!inserted) throw new Error('continuity contract missing after insert');
        saved = inserted;
      } else {
        const [updated] = await tx
          .update(continuityContracts)
          .set({
            lifecycle: 'active',
            currentRevision: nextRevision,
            authorizationVersion: nextRevision,
            factsVersion: nextFacts,
            pausedUntil: null,
            updatedAt: now,
          })
          .where(and(eq(continuityContracts.id, contract.id), eq(continuityContracts.userId, userId)))
          .returning();
        if (!updated) throw new Error('continuity contract missing after update');
        saved = updated;
      }
      const key =
        input.idempotencyKey && previous?.idempotencyKey === input.idempotencyKey
          ? null
          : (input.idempotencyKey ?? null);
      const [revision] = await tx
        .insert(continuityContractRevisions)
        .values(revisionValues(userId, saved.id, nextRevision, fields, key, now, now))
        .returning();
      if (!revision) throw new Error('continuity revision missing after insert');
      await insertContinuityEvent(
        tx,
        userId,
        saved.id,
        'contract.activated',
        { outcomeId: outcome.id, revision: nextRevision },
        now,
      );
      await enqueueContinuityRecompute(tx, userId, saved.id, now);
      return responseOf(saved, revision, fields);
    });
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const replayedAfter = await replayIdempotency(
        userId,
        outcome.id,
        input.idempotencyKey,
        user,
        true,
      );
      if (replayedAfter) return replayedAfter;
    }
    if (isUniqueViolation(err)) {
      const existing = await loadContract(getDb(), userId, outcome.id, false);
      if (existing?.lifecycle === 'active') {
        const revision = await loadRevision(getDb(), existing.id, existing.currentRevision);
        return responseOf(existing, revision, emptyFallback(user));
      }
    }
    throw err;
  }
}

async function mutateLifecycle(
  userId: string,
  outcomeId: string,
  expectedVersion: number | undefined,
  now: Date,
  apply: (row: ContinuityContractRow) => {
    lifecycle: ContinuityContractRow['lifecycle'];
    pausedUntil?: Date | null;
    eventType: string;
    eventPayload?: Record<string, unknown>;
    skip?: boolean;
  },
): Promise<ContinuityGetResponse> {
  const outcome = await getOwnedOutcomeOr404(userId, outcomeId);
  const user = await getUserEntity(userId);
  return getDb().transaction(async (tx) => {
    const contract = await loadContract(tx, userId, outcome.id, true);
    if (!contract) throw AppError.of(404, 'NOT_FOUND');
    const patch = apply(contract);
    if (patch.skip) {
      const revision = await loadRevision(tx, contract.id, contract.currentRevision);
      return responseOf(contract, revision, emptyFallback(user));
    }
    assertExpectedVersion(contract.currentRevision, expectedVersion);
    const [updated] = await tx
      .update(continuityContracts)
      .set({
        lifecycle: patch.lifecycle,
        pausedUntil: patch.pausedUntil === undefined ? contract.pausedUntil : patch.pausedUntil,
        factsVersion: contract.factsVersion + 1,
        updatedAt: now,
      })
      .where(and(eq(continuityContracts.id, contract.id), eq(continuityContracts.userId, userId)))
      .returning();
    if (!updated) throw new Error('continuity contract missing after update');
    await insertContinuityEvent(
      tx,
      userId,
      updated.id,
      patch.eventType,
      { outcomeId: outcome.id, revision: updated.currentRevision, ...patch.eventPayload },
      now,
    );
    await enqueueContinuityRecompute(tx, userId, updated.id, now);
    if (patch.lifecycle === 'paused' || patch.lifecycle === 'ended') {
      const { interruptOpenExperiments } = await import('./experiments.service.js');
      await interruptOpenExperiments(tx, updated.id, now);
    }
    const revision = await loadRevision(tx, updated.id, updated.currentRevision);
    return responseOf(updated, revision, emptyFallback(user));
  });
}

export async function pauseContinuity(
  userId: string,
  outcomeId: string,
  input: ContinuityPauseInput,
  now = new Date(),
): Promise<ContinuityGetResponse> {
  return mutateLifecycle(userId, outcomeId, input.expectedVersion, now, (row) => {
    if (row.lifecycle === 'ended') throw AppError.of(404, 'NOT_FOUND');
    return {
      lifecycle: 'paused',
      pausedUntil: input.until ? new Date(input.until) : null,
      eventType: 'contract.paused',
      eventPayload: { until: input.until ?? null },
    };
  });
}

export async function resumeContinuity(
  userId: string,
  outcomeId: string,
  input: ContinuityVersionInput,
  now = new Date(),
): Promise<ContinuityGetResponse> {
  return mutateLifecycle(userId, outcomeId, input.expectedVersion, now, (row) => {
    if (row.lifecycle === 'active') {
      return { lifecycle: 'active', eventType: 'contract.resumed', skip: true };
    }
    if (row.lifecycle !== 'paused') throw AppError.of(404, 'NOT_FOUND');
    return { lifecycle: 'active', pausedUntil: null, eventType: 'contract.resumed' };
  });
}

export async function endContinuity(
  userId: string,
  outcomeId: string,
  input: ContinuityVersionInput,
  now = new Date(),
): Promise<ContinuityGetResponse> {
  return mutateLifecycle(userId, outcomeId, input.expectedVersion, now, (row) => {
    if (row.lifecycle === 'ended') {
      return { lifecycle: 'ended', eventType: 'contract.ended', skip: true };
    }
    return { lifecycle: 'ended', eventType: 'contract.ended' };
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Write a new immutable revision on an already-active contract (cadence / minAction). */
export async function writeActiveContractRevision(
  tx: AgentJobTransaction,
  userId: string,
  contract: ContinuityContractRow,
  patch: { cadence?: ContinuityCadence; minAction?: ContinuityMinAction },
  now: Date,
): Promise<{
  contract: ContinuityContractRow;
  revision: ContinuityContractRevisionRow;
  previous: ContinuityContractRevisionRow;
  changed: boolean;
}> {
  const previous = await loadRevision(tx, contract.id, contract.currentRevision);
  if (!previous) throw AppError.of(404, 'NOT_FOUND');
  const cadenceChanged = patch.cadence !== undefined && !sameJson(patch.cadence, previous.cadence);
  const minActionChanged =
    patch.minAction !== undefined && !sameJson(patch.minAction, previous.minAction);
  if (!cadenceChanged && !minActionChanged) {
    return { contract, revision: previous, previous, changed: false };
  }
  const fields: RevisionFields = {
    ...fieldsFromRevision(previous),
    ...(cadenceChanged && patch.cadence ? { cadence: patch.cadence } : {}),
    ...(minActionChanged && patch.minAction ? { minAction: patch.minAction } : {}),
  };
  const nextRevision = contract.currentRevision + 1;
  const [updated] = await tx
    .update(continuityContracts)
    .set({
      currentRevision: nextRevision,
      factsVersion: contract.factsVersion + 1,
      updatedAt: now,
    })
    .where(and(eq(continuityContracts.id, contract.id), eq(continuityContracts.userId, userId)))
    .returning();
  if (!updated) throw new Error('continuity contract missing after revision');
  const [revision] = await tx
    .insert(continuityContractRevisions)
    .values(revisionValues(userId, updated.id, nextRevision, fields, null, now, now))
    .returning();
  if (!revision) throw new Error('continuity revision missing after insert');
  await insertContinuityEvent(
    tx,
    userId,
    updated.id,
    'contract.revised',
    { revision: nextRevision, cadenceChanged, minActionChanged },
    now,
  );
  await enqueueContinuityRecompute(tx, userId, updated.id, now);
  return { contract: updated, revision, previous, changed: true };
}

function settingsToDto(row: typeof continuityUserSettings.$inferSelect): ContinuitySettings {
  return {
    explorationWeekend: row.explorationWeekend,
    explorationHoliday: row.explorationHoliday,
    region: row.region ?? null,
    externalSearch: row.externalSearch,
    dailyPushLimit: row.dailyPushLimit,
    weeklyPushLimit: row.weeklyPushLimit,
    defaultCadence: row.defaultCadence ?? null,
  };
}

export async function getContinuitySettings(userId: string): Promise<ContinuitySettings> {
  await getUserEntity(userId);
  const [row] = await getDb()
    .select()
    .from(continuityUserSettings)
    .where(eq(continuityUserSettings.userId, userId))
    .limit(1);
  if (!row) return { ...DEFAULT_SETTINGS };
  return settingsToDto(row);
}

export async function putContinuitySettings(
  userId: string,
  input: PutContinuitySettingsInput,
  now = new Date(),
): Promise<ContinuitySettings> {
  await getUserEntity(userId);
  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(continuityUserSettings)
      .where(eq(continuityUserSettings.userId, userId))
      .limit(1)
      .for('update');
    if (!existing) {
      const [inserted] = await tx
        .insert(continuityUserSettings)
        .values({
          userId,
          explorationWeekend: input.explorationWeekend ?? DEFAULT_SETTINGS.explorationWeekend,
          explorationHoliday: input.explorationHoliday ?? DEFAULT_SETTINGS.explorationHoliday,
          region: input.region === undefined ? DEFAULT_SETTINGS.region : input.region,
          externalSearch: input.externalSearch ?? DEFAULT_SETTINGS.externalSearch,
          dailyPushLimit: input.dailyPushLimit ?? DEFAULT_SETTINGS.dailyPushLimit,
          weeklyPushLimit: input.weeklyPushLimit ?? DEFAULT_SETTINGS.weeklyPushLimit,
          defaultCadence: input.defaultCadence === undefined ? null : input.defaultCadence,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!inserted) throw new Error('continuity settings missing after insert');
      return settingsToDto(inserted);
    }
    const [updated] = await tx
      .update(continuityUserSettings)
      .set({
        explorationWeekend: input.explorationWeekend ?? existing.explorationWeekend,
        explorationHoliday: input.explorationHoliday ?? existing.explorationHoliday,
        region: input.region === undefined ? existing.region : input.region,
        externalSearch: input.externalSearch ?? existing.externalSearch,
        dailyPushLimit: input.dailyPushLimit ?? existing.dailyPushLimit,
        weeklyPushLimit: input.weeklyPushLimit ?? existing.weeklyPushLimit,
        defaultCadence:
          input.defaultCadence === undefined ? existing.defaultCadence : input.defaultCadence,
        updatedAt: now,
      })
      .where(eq(continuityUserSettings.userId, userId))
      .returning();
    if (!updated) throw new Error('continuity settings missing after update');
    return settingsToDto(updated);
  });
}
