import { randomUUID } from 'node:crypto';
import type { ContinuityInterventionContent, ContinuityMinAction } from '@vital/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AgentJobTransaction } from '../agent/job-runtime.js';
import {
  continuityDependencies,
  continuityInterventions,
  continuityProtectedBlocks,
  tasks,
  users,
  type ContinuityContractRevisionRow,
  type ContinuityContractRow,
  type ContinuityInterventionRow,
  type TaskRow,
} from '../db/schema.js';
import { maybeEnqueueContinuityPush } from './delivery-policy.js';
import { withdrawInterventionRows, withdrawOpenKind } from './interventions.service.js';
import {
  evaluateWorkRisk,
  isWorkRiskWorthShowing,
  occupancyFromTask,
  workRiskFactFingerprint,
  type OccupancyInterval,
  type WorkRiskDecision,
  type WorkRiskProtectedBlock,
} from './rules/work-risk.js';

const WORK_RISK_KIND = 'work_risk' as const;
const OPEN_STATUSES = ['open', 'snoozed'] as const;
const OPEN_TASK = ['todo', 'doing'] as const;
const CANDIDATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SECONDARY_ACTIONS: ContinuityInterventionContent['secondaryActions'] = [
  { kind: 'log', title: '补记估时或截止' },
  { kind: 'snooze', title: '晚点再说' },
  { kind: 'pause', title: '暂停跟进' },
];

function workRiskContent(
  decision: WorkRiskDecision,
  minAction: ContinuityMinAction,
  remainingMinutes: number | null,
): ContinuityInterventionContent {
  const durationMin =
    remainingMinutes !== null && remainingMinutes > 0
      ? Math.min(remainingMinutes, 480)
      : minAction.durationMin;
  const title =
    decision.kind === 'unconfirmed'
      ? '补全估时或依赖'
      : minAction.title.trim() !== ''
        ? minAction.title
        : '开始这一步';
  return {
    facts: decision.facts.length > 0 ? decision.facts : ['风险待确认'],
    whyNow: decision.whyNow,
    primaryAction: {
      title,
      durationMin,
      completionStandard: minAction.completionStandard,
    },
    secondaryActions: SECONDARY_ACTIONS,
  };
}

function remainingWork(rows: readonly TaskRow[]): {
  remainingMinutes: number | null;
  dueAt: Date | null;
  splitAllowed: boolean;
} {
  const unplaced: TaskRow[] = [];
  for (const row of rows) {
    if (occupancyFromTask(row)) continue;
    unplaced.push(row);
  }
  if (unplaced.length === 0) {
    return { remainingMinutes: 0, dueAt: null, splitAllowed: false };
  }
  let missingEstimate = false;
  let minutes = 0;
  for (const row of unplaced) {
    if (row.estimateMinutes === null) missingEstimate = true;
    else minutes += row.estimateMinutes;
  }
  let missingDue = false;
  let dueAt: Date | null = null;
  for (const row of unplaced) {
    if (!row.dueAt) {
      missingDue = true;
      continue;
    }
    if (!dueAt || row.dueAt.getTime() < dueAt.getTime()) dueAt = row.dueAt;
  }
  const splitAllowed = unplaced.length === 1 && unplaced[0]?.splitAllowed === true;
  return {
    remainingMinutes: missingEstimate ? null : minutes,
    dueAt: missingDue ? null : dueAt,
    splitAllowed,
  };
}

export async function syncWorkRiskIntervention(
  tx: AgentJobTransaction,
  input: {
    userId: string;
    contract: ContinuityContractRow;
    revision: ContinuityContractRevisionRow;
    now: Date;
  },
): Promise<ContinuityInterventionRow | null> {
  const { contract, revision, now } = input;
  if (contract.lifecycle !== 'active') {
    await withdrawOpenKind(tx, contract.id, WORK_RISK_KIND, now);
    return null;
  }

  const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) {
    await withdrawOpenKind(tx, contract.id, WORK_RISK_KIND, now);
    return null;
  }

  const remainingRows = await tx
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, input.userId),
        eq(tasks.outcomeId, contract.outcomeId),
        inArray(tasks.status, [...OPEN_TASK]),
        isNull(tasks.deletedAt),
      ),
    );
  const remaining = remainingWork(remainingRows);

  const timedRows = await tx
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.userId, input.userId), inArray(tasks.status, [...OPEN_TASK]), isNull(tasks.deletedAt)),
    );
  const occupancy: OccupancyInterval[] = [];
  for (const row of timedRows) {
    const slot = occupancyFromTask(row);
    if (slot) occupancy.push(slot);
  }

  const protectedRows = await tx
    .select()
    .from(continuityProtectedBlocks)
    .where(eq(continuityProtectedBlocks.userId, input.userId));
  const protectedBlocks: WorkRiskProtectedBlock[] = protectedRows.map((row) => ({
    kind: row.kind as WorkRiskProtectedBlock['kind'],
    timezone: row.timezone,
    startAt: row.startAt,
    endAt: row.endAt,
    weekday: row.weekday,
    startHm: row.startHm,
    endHm: row.endHm,
    version: row.version,
  }));

  const openDeps = await tx
    .select()
    .from(continuityDependencies)
    .where(
      and(
        eq(continuityDependencies.contractId, contract.id),
        eq(continuityDependencies.status, 'open'),
      ),
    );

  const decision = evaluateWorkRisk({
    remainingMinutes: remaining.remainingMinutes,
    dueAt: remaining.dueAt,
    workHours: { startHm: user.workHoursStart, endHm: user.workHoursEnd },
    timezone: revision.timezone || user.timezone,
    occupancy,
    protectedBlocks,
    openDependencies: openDeps.map((row) => ({
      id: row.id,
      prerequisiteType: row.prerequisiteType as 'task' | 'outcome' | 'external',
      expectedUnblockAt: null,
    })),
    splitAllowed: remaining.splitAllowed,
    now,
  });

  const openRows = await tx
    .select()
    .from(continuityInterventions)
    .where(
      and(
        eq(continuityInterventions.contractId, contract.id),
        eq(continuityInterventions.kind, WORK_RISK_KIND),
        inArray(continuityInterventions.status, [...OPEN_STATUSES]),
      ),
    );

  if (!isWorkRiskWorthShowing(decision, {
    remainingMinutes: remaining.remainingMinutes,
    dueAt: remaining.dueAt,
    workHours: { startHm: user.workHoursStart, endHm: user.workHoursEnd },
    timezone: revision.timezone || user.timezone,
    occupancy,
    protectedBlocks,
    openDependencies: openDeps.map((row) => ({
      id: row.id,
      prerequisiteType: row.prerequisiteType as 'task' | 'outcome' | 'external',
      expectedUnblockAt: null,
    })),
    splitAllowed: remaining.splitAllowed,
    now,
  })) {
    await withdrawOpenKind(tx, contract.id, WORK_RISK_KIND, now);
    return null;
  }

  const fingerprint = workRiskFactFingerprint({
    kind: decision.kind,
    missing: decision.missing,
    latestStartAt: decision.latestStartAt,
    latestUnblockAt: decision.latestUnblockAt,
    remainingMinutes: remaining.remainingMinutes,
    dueAt: remaining.dueAt,
    occupancy,
    openDependencyIds: openDeps.map((row) => row.id),
    splitAllowed: remaining.splitAllowed,
    protectedVersions: protectedRows.map((row) => row.version),
  });
  const content = workRiskContent(decision, revision.minAction, remaining.remainingMinutes);
  const same = openRows.filter(
    (row) => row.factFingerprint === fingerprint && row.revision === revision.revision,
  );
  const others = openRows.filter((row) => !same.includes(row));
  if (others.length > 0) {
    await withdrawInterventionRows(tx, others, now);
  }

  const existing = same[0];
  const actionableUntil = decision.latestStartAt;
  const expiresAt = new Date(now.getTime() + CANDIDATE_TTL_MS);
  if (existing) {
    const [updated] = await tx
      .update(continuityInterventions)
      .set({ content, actionableUntil, expiresAt, updatedAt: now })
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

  const [inserted] = await tx
    .insert(continuityInterventions)
    .values({
      id: randomUUID(),
      userId: input.userId,
      contractId: contract.id,
      revision: revision.revision,
      kind: WORK_RISK_KIND,
      factFingerprint: fingerprint,
      status: 'open',
      expiresAt,
      actionableUntil,
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
