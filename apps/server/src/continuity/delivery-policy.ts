import { randomUUID } from 'node:crypto';
import { addDaysYmd, type ContinuityExposureSurface } from '@vital/dto';
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { AgentJobTransaction } from '../agent/job-runtime.js';
import { getDb } from '../db/index.js';
import {
  continuityContracts,
  continuityExposures,
  continuityInterventions,
  continuityUserSettings,
  notificationOutbox,
  users,
  type ContinuityContractRow,
  type ContinuityInterventionRow,
  type NotificationOutboxPayload,
  type NotificationOutboxRow,
  type User,
} from '../db/schema.js';
import { applyQuietHours } from '../notifications/quiet-hours.js';
import { isContinuityEnabled } from './flag.js';
import { eachYmd, localYmd, startOfWeekYmd } from './rules/clock.js';

export type ContinuityTx = AgentJobTransaction;

export const STALL_PUSH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const WORK_RISK_PUSH_DAILY_EXTRA = 1;
export const WORK_RISK_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CONTINUITY_TITLE = '值得留意';
export const CONTINUITY_DEEPLINK = '/today';

const LIVE_OUTBOX = ['pending', 'preparing', 'sending'] as const;
const REPORT_SURFACES = ['morning_brief', 'evening_digest', 'weekly'] as const;

export function dailyPeriodKey(ymd: string): string {
  return `d:${ymd}`;
}

function weekPeriodKeys(ymd: string, weekStartsOn: 0 | 1): string[] {
  const start = startOfWeekYmd(ymd, weekStartsOn);
  return eachYmd(start, addDaysYmd(start, 6)).map(dailyPeriodKey);
}

function weekStartsOnOf(value: number): 0 | 1 {
  return value === 0 ? 0 : 1;
}

function livePushWhere(userId: string, budgetClass: 'ordinary' | 'work_risk' = 'ordinary') {
  return and(
    eq(continuityExposures.userId, userId),
    eq(continuityExposures.surface, 'push'),
    eq(continuityExposures.budgetClass, budgetClass),
    isNull(continuityExposures.failedAt),
    or(isNotNull(continuityExposures.reservedAt), isNotNull(continuityExposures.sentAt)),
  );
}

async function lockSettings(tx: ContinuityTx, userId: string, now: Date) {
  await tx
    .insert(continuityUserSettings)
    .values({ userId, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(continuityUserSettings)
    .where(eq(continuityUserSettings.userId, userId))
    .limit(1)
    .for('update');
  return row;
}

async function countLivePush(
  tx: ContinuityTx,
  userId: string,
  periodKeys: readonly string[],
  budgetClass: 'ordinary' | 'work_risk' = 'ordinary',
): Promise<number> {
  if (periodKeys.length === 0) return 0;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(continuityExposures)
    .where(
      and(
        livePushWhere(userId, budgetClass),
        inArray(continuityExposures.periodKey, [...periodKeys]),
      ),
    );
  return row?.n ?? 0;
}

/** Lock settings, then count sent+reserved ordinary push. Null when the period is full. */
export async function reserveOrdinaryPush(
  tx: ContinuityTx,
  input: {
    userId: string;
    candidateId: string;
    now: Date;
    timezone: string;
    weekStartsOn: 0 | 1;
  },
): Promise<{ id: string; periodKey: string } | null> {
  const settings = await lockSettings(tx, input.userId, input.now);
  const dailyLimit = settings?.dailyPushLimit ?? 1;
  const weeklyLimit = settings?.weeklyPushLimit ?? 3;
  const ymd = localYmd(input.now, input.timezone);
  const dayKey = dailyPeriodKey(ymd);
  const weekKeys = weekPeriodKeys(ymd, input.weekStartsOn);
  if ((await countLivePush(tx, input.userId, [dayKey])) >= dailyLimit) return null;
  if ((await countLivePush(tx, input.userId, weekKeys)) >= weeklyLimit) return null;
  const id = randomUUID();
  await tx.insert(continuityExposures).values({
    id,
    userId: input.userId,
    candidateId: input.candidateId,
    surface: 'push',
    reservedAt: input.now,
    budgetClass: 'ordinary',
    periodKey: dayKey,
    createdAt: input.now,
  });
  return { id, periodKey: dayKey };
}

/** Extra daily 1 for work-risk. Does not consume ordinary stall/task reminder quota. */
export async function reserveWorkRiskPush(
  tx: ContinuityTx,
  input: {
    userId: string;
    candidateId: string;
    now: Date;
    timezone: string;
  },
): Promise<{ id: string; periodKey: string } | null> {
  await lockSettings(tx, input.userId, input.now);
  const ymd = localYmd(input.now, input.timezone);
  const dayKey = dailyPeriodKey(ymd);
  if ((await countLivePush(tx, input.userId, [dayKey], 'work_risk')) >= WORK_RISK_PUSH_DAILY_EXTRA) {
    return null;
  }
  const id = randomUUID();
  await tx.insert(continuityExposures).values({
    id,
    userId: input.userId,
    candidateId: input.candidateId,
    surface: 'push',
    reservedAt: input.now,
    budgetClass: 'work_risk',
    periodKey: dayKey,
    createdAt: input.now,
  });
  return { id, periodKey: dayKey };
}

export async function hasTodaySeen(
  tx: Pick<ContinuityTx, 'select'>,
  candidateId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: continuityExposures.id })
    .from(continuityExposures)
    .where(
      and(
        eq(continuityExposures.candidateId, candidateId),
        eq(continuityExposures.surface, 'today'),
        isNotNull(continuityExposures.seenAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function hasReportExposure(
  tx: Pick<ContinuityTx, 'select'>,
  candidateId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: continuityExposures.id })
    .from(continuityExposures)
    .where(
      and(
        eq(continuityExposures.candidateId, candidateId),
        inArray(continuityExposures.surface, [...REPORT_SURFACES]),
        isNull(continuityExposures.failedAt),
        or(
          isNotNull(continuityExposures.reservedAt),
          isNotNull(continuityExposures.sentAt),
          isNotNull(continuityExposures.seenAt),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function lastStallPushSentAt(
  tx: Pick<ContinuityTx, 'select'>,
  contractId: string,
): Promise<Date | null> {
  const [row] = await tx
    .select({ sentAt: continuityExposures.sentAt })
    .from(continuityExposures)
    .innerJoin(
      continuityInterventions,
      eq(continuityInterventions.id, continuityExposures.candidateId),
    )
    .where(
      and(
        eq(continuityInterventions.contractId, contractId),
        eq(continuityInterventions.kind, 'stall_adjust'),
        eq(continuityExposures.surface, 'push'),
        isNotNull(continuityExposures.sentAt),
      ),
    )
    .orderBy(desc(continuityExposures.sentAt))
    .limit(1);
  return row?.sentAt ?? null;
}

function candidateListable(row: ContinuityInterventionRow, now: Date): boolean {
  if (row.status !== 'open' && row.status !== 'snoozed') return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Morning brief / digest / today can call this to share one candidate across surfaces.
 * Push is suppressed when the candidate was already seen or carried in a report.
 */
export async function wouldExpose(
  candidateId: string,
  surface: ContinuityExposureSurface,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(continuityInterventions)
    .where(eq(continuityInterventions.id, candidateId))
    .limit(1);
  if (!row || !candidateListable(row, now)) return false;
  if (surface !== 'push') return true;
  const [contract] = await db
    .select()
    .from(continuityContracts)
    .where(eq(continuityContracts.id, row.contractId))
    .limit(1);
  if (!contract || contract.lifecycle !== 'active') return false;
  if (contract.inAppOnlyUntil && contract.inAppOnlyUntil.getTime() > now.getTime()) return false;
  if (await hasTodaySeen(db, candidateId)) return false;
  if (await hasReportExposure(db, candidateId)) return false;
  return true;
}

export function continuityIdempotencyKey(candidateId: string, revision: number): string {
  return `agent.continuity:${candidateId}:${String(revision)}`;
}

function continuityPayload(
  user: Pick<User, 'timezone'>,
  intervention: ContinuityInterventionRow,
  outcomeId: string,
  message: string,
): NotificationOutboxPayload {
  return {
    title: CONTINUITY_TITLE,
    listId: '',
    listName: '',
    dueAt: null,
    remindAt: null,
    isAllDay: false,
    timezone: user.timezone,
    eventType: 'agent.continuity',
    message,
    deeplink: CONTINUITY_DEEPLINK,
    candidateId: intervention.id,
    outcomeId,
    revision: intervention.revision,
  };
}

async function liveOutboxForCandidate(
  tx: Pick<ContinuityTx, 'select'>,
  candidateId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: notificationOutbox.id })
    .from(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.eventType, 'agent.continuity'),
        eq(notificationOutbox.entityId, candidateId),
        inArray(notificationOutbox.status, [...LIVE_OUTBOX]),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function hasPushSentForCandidate(
  tx: Pick<ContinuityTx, 'select'>,
  candidateId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: continuityExposures.id })
    .from(continuityExposures)
    .where(
      and(
        eq(continuityExposures.candidateId, candidateId),
        eq(continuityExposures.surface, 'push'),
        isNotNull(continuityExposures.sentAt),
        isNull(continuityExposures.failedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

function isWorkRiskPushReady(intervention: ContinuityInterventionRow, now: Date): boolean {
  if (intervention.kind !== 'work_risk') return false;
  const latest = intervention.actionableUntil;
  if (!latest) return false;
  return latest.getTime() - now.getTime() < WORK_RISK_WINDOW_MS;
}

export async function maybeEnqueueContinuityPush(
  tx: ContinuityTx,
  input: {
    userId: string;
    contract: ContinuityContractRow;
    intervention: ContinuityInterventionRow;
    message: string;
    now: Date;
  },
): Promise<string | null> {
  if (!isContinuityEnabled()) return null;
  const { contract, intervention, now } = input;
  if (contract.lifecycle !== 'active') return null;
  if (intervention.status !== 'open') return null;
  if (intervention.expiresAt && intervention.expiresAt.getTime() <= now.getTime()) return null;
  const workRisk = intervention.kind === 'work_risk';
  if (workRisk && !isWorkRiskPushReady(intervention, now)) return null;
  if (!workRisk && contract.inAppOnlyUntil && contract.inAppOnlyUntil.getTime() > now.getTime()) {
    return null;
  }
  if (await hasTodaySeen(tx, intervention.id)) return null;
  if (await hasReportExposure(tx, intervention.id)) return null;
  if (await liveOutboxForCandidate(tx, intervention.id)) return null;
  if (workRisk) {
    if (await hasPushSentForCandidate(tx, intervention.id)) return null;
  } else {
    const lastSent = await lastStallPushSentAt(tx, contract.id);
    if (lastSent && now.getTime() - lastSent.getTime() < STALL_PUSH_COOLDOWN_MS) return null;
  }

  const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) return null;

  const reserved = workRisk
    ? await reserveWorkRiskPush(tx, {
        userId: input.userId,
        candidateId: intervention.id,
        now,
        timezone: user.timezone,
      })
    : await reserveOrdinaryPush(tx, {
        userId: input.userId,
        candidateId: intervention.id,
        now,
        timezone: user.timezone,
        weekStartsOn: weekStartsOnOf(user.weekStartsOn),
      });
  if (!reserved) return null;

  const scheduledAt = applyQuietHours(now, user.quietHoursStart, user.quietHoursEnd, user.timezone);
  const outboxId = randomUUID();
  const inserted = await tx
    .insert(notificationOutbox)
    .values({
      id: outboxId,
      userId: input.userId,
      eventType: 'agent.continuity',
      entityType: 'continuity',
      entityId: intervention.id,
      occurrenceAt: now,
      idempotencyKey: continuityIdempotencyKey(intervention.id, intervention.revision),
      scheduledAt,
      status: 'pending',
      payload: continuityPayload(user, intervention, contract.outcomeId, input.message),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: notificationOutbox.id });
  if (!inserted[0]) {
    await tx
      .update(continuityExposures)
      .set({ failedAt: now })
      .where(eq(continuityExposures.id, reserved.id));
    return null;
  }
  await tx
    .update(continuityExposures)
    .set({ outboxId: inserted[0].id })
    .where(eq(continuityExposures.id, reserved.id));
  return inserted[0].id;
}

export async function releaseContinuityOutbox(outboxId: string, now: Date): Promise<void> {
  await getDb()
    .update(continuityExposures)
    .set({ failedAt: now })
    .where(
      and(
        eq(continuityExposures.outboxId, outboxId),
        isNull(continuityExposures.failedAt),
        isNull(continuityExposures.sentAt),
      ),
    );
}

export async function markContinuityPushSent(outboxId: string, now: Date): Promise<void> {
  await getDb()
    .update(continuityExposures)
    .set({ sentAt: now })
    .where(
      and(
        eq(continuityExposures.outboxId, outboxId),
        eq(continuityExposures.surface, 'push'),
        isNull(continuityExposures.failedAt),
      ),
    );
}

function claimed(id: string) {
  return and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, 'sending'));
}

async function cancelClaimed(id: string, now: Date, lastError: string): Promise<void> {
  await getDb()
    .update(notificationOutbox)
    .set({ status: 'cancelled', updatedAt: now, lastError })
    .where(claimed(id));
  await releaseContinuityOutbox(id, now);
}

export async function cancelPendingContinuityPush(
  tx: ContinuityTx,
  candidateId: string,
  now: Date,
  lastError: string,
): Promise<void> {
  const rows = await tx
    .update(notificationOutbox)
    .set({ status: 'cancelled', updatedAt: now, lastError })
    .where(
      and(
        eq(notificationOutbox.eventType, 'agent.continuity'),
        eq(notificationOutbox.entityId, candidateId),
        inArray(notificationOutbox.status, ['pending', 'preparing']),
      ),
    )
    .returning({ id: notificationOutbox.id });
  for (const row of rows) {
    await tx
      .update(continuityExposures)
      .set({ failedAt: now })
      .where(
        and(
          eq(continuityExposures.outboxId, row.id),
          isNull(continuityExposures.failedAt),
          isNull(continuityExposures.sentAt),
        ),
      );
  }
}

function whyNowOf(content: ContinuityInterventionRow['content']): string {
  return typeof content.whyNow === 'string' ? content.whyNow : '';
}

/** Recheck candidate, budget, in-app-only, and quiet hours after claim. */
export async function prepareContinuityPush(
  user: User,
  job: NotificationOutboxRow,
  now: Date,
): Promise<'ready' | 'stop'> {
  if (!isContinuityEnabled()) {
    await cancelClaimed(job.id, now, 'continuity disabled');
    return 'stop';
  }
  const [row] = await getDb()
    .select()
    .from(continuityInterventions)
    .where(
      and(eq(continuityInterventions.id, job.entityId), eq(continuityInterventions.userId, user.id)),
    )
    .limit(1);
  if (!row || row.status !== 'open') {
    await cancelClaimed(job.id, now, 'candidate closed');
    return 'stop';
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    await cancelClaimed(job.id, now, 'candidate expired');
    return 'stop';
  }
  const [contract] = await getDb()
    .select()
    .from(continuityContracts)
    .where(eq(continuityContracts.id, row.contractId))
    .limit(1);
  if (!contract || contract.lifecycle !== 'active') {
    await cancelClaimed(job.id, now, 'contract inactive');
    return 'stop';
  }
  const workRisk = row.kind === 'work_risk';
  if (workRisk && !isWorkRiskPushReady(row, now)) {
    await cancelClaimed(job.id, now, 'work-risk window not open');
    return 'stop';
  }
  if (!workRisk && contract.inAppOnlyUntil && contract.inAppOnlyUntil.getTime() > now.getTime()) {
    await cancelClaimed(job.id, now, 'in-app only');
    return 'stop';
  }
  if (await hasTodaySeen(getDb(), row.id)) {
    await cancelClaimed(job.id, now, 'seen in app');
    return 'stop';
  }
  if (await hasReportExposure(getDb(), row.id)) {
    await cancelClaimed(job.id, now, 'already exposed');
    return 'stop';
  }

  const delayed = applyQuietHours(now, user.quietHoursStart, user.quietHoursEnd, user.timezone);
  if (delayed.getTime() > now.getTime() + 1_000) {
    const sameDay = localYmd(delayed, user.timezone) === localYmd(now, user.timezone);
    if (!sameDay) {
      const moved = await getDb().transaction(async (tx) => {
        await tx
          .update(continuityExposures)
          .set({ failedAt: now })
          .where(
            and(
              eq(continuityExposures.outboxId, job.id),
              isNull(continuityExposures.failedAt),
              isNull(continuityExposures.sentAt),
            ),
          );
        return workRisk
          ? reserveWorkRiskPush(tx, {
              userId: user.id,
              candidateId: row.id,
              now: delayed,
              timezone: user.timezone,
            })
          : reserveOrdinaryPush(tx, {
              userId: user.id,
              candidateId: row.id,
              now: delayed,
              timezone: user.timezone,
              weekStartsOn: weekStartsOnOf(user.weekStartsOn),
            });
      });
      if (!moved) {
        await cancelClaimed(job.id, now, 'budget after quiet hours');
        return 'stop';
      }
      await getDb()
        .update(continuityExposures)
        .set({ outboxId: job.id })
        .where(eq(continuityExposures.id, moved.id));
    }
    await getDb()
      .update(notificationOutbox)
      .set({ status: 'pending', scheduledAt: delayed, updatedAt: now })
      .where(claimed(job.id));
    return 'stop';
  }

  const payload: NotificationOutboxPayload = {
    ...job.payload,
    ...continuityPayload(user, row, contract.outcomeId, whyNowOf(row.content)),
  };
  const updated = await getDb()
    .update(notificationOutbox)
    .set({ payload, updatedAt: now })
    .where(claimed(job.id))
    .returning({ id: notificationOutbox.id });
  if (updated.length === 0) return 'stop';
  job.payload = payload;
  return 'ready';
}
