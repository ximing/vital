import { randomUUID } from 'node:crypto';
import type { ChatPlanDiff, ChatUndoHint, PlanDependencyGroup, PlanProtectedBlockVersion } from '@vital/dto';
import { and, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { recordAgentEdit } from '../agent/edit-events.service.js';
import {
  enqueueOutcomeRefresh,
  enqueueTaskDecompose,
  enqueueTodayLayout,
  hasPendingDecomposeAction,
  type AgentDb,
} from '../agent/jobs.js';
import { markAgentSchedule } from '../agent/scheduling.js';
import { getDb, type Database } from '../db/index.js';
import {
  continuityContracts,
  continuityProtectedBlocks,
  outcomes,
  taskCompletions,
  tasks,
  type ContinuityProtectedBlockRow,
  type TaskRow,
  type User,
} from '../db/schema.js';
import { syncTaskNotifications } from '../notifications/outbox.js';
import { isDefer, needsDecomposition } from '../outcomes/rule-engine.js';
import { syncContinuityOnTaskComplete } from './dependencies.service.js';
import { enqueueContinuityRecompute } from './enqueue.js';
import { expandProtectedBlock, occupancyFromTask, type OccupancyInterval, type WorkRiskProtectedBlock } from './rules/work-risk.js';

export type PlanTx = Parameters<Parameters<Database['transaction']>[0]>[0];

type PlanStep = Extract<ChatUndoHint, { kind: 'plan' }>['steps'][number];

export interface PlanApplyPatch {
  taskId: string;
  revision: string;
  title?: string | undefined;
  dueYmd?: string | null | undefined;
  startAt?: string | undefined;
  dueAt?: string | undefined;
  priority?: 0 | 1 | 2 | 3 | undefined;
  status?: 'todo' | 'doing' | 'done' | 'canceled' | undefined;
  outcomeId?: string | null | undefined;
  isMilestone?: boolean | undefined;
}

export interface AppliedPlanItem {
  taskId: string;
  title: string;
  summary: string;
  steps: PlanStep[];
  afterRevision: string;
  indexed: TaskRow;
}

export interface ApplyPlanPatchesResult {
  applied: AppliedPlanItem[];
  skipped: { taskId: string; reason: string }[];
}

export interface ApplyPlanPatchesInput {
  user: User;
  userId: string;
  timezone: string;
  patches: readonly PlanApplyPatch[];
  groups?: readonly PlanDependencyGroup[] | undefined;
  now: Date;
}

interface PlanCandidate {
  patch: PlanApplyPatch;
  row: TaskRow;
  column: Partial<TaskRow>;
  previous: Record<string, unknown>;
  fields: { field: string; before: unknown; after: unknown }[];
  wantComplete: boolean;
  nextDue: Date | null;
}

function dueAtFromYmd(ymd: string, zone: string): Date | null {
  const dt = DateTime.fromISO(`${ymd}T00:00:00`, { zone });
  return dt.isValid ? dt.toJSDate() : null;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

export function samePlanRevision(updatedAt: Date, revision: string): boolean {
  const parsed = Date.parse(revision);
  return Number.isFinite(parsed) && updatedAt.getTime() === parsed;
}

function isRecurring(row: TaskRow): boolean {
  return row.recurrenceRrule !== null || row.recurrenceKind !== null;
}

function clipTitle(value: string): string {
  return value.length > 120 ? value.slice(0, 120) : value;
}

export function intervalsOverlap(a: OccupancyInterval, b: OccupancyInterval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

export function patchChangesTime(patch: PlanApplyPatch): boolean {
  return patch.startAt !== undefined || patch.dueYmd !== undefined;
}

export function occupancyFromPatch(row: TaskRow, patch: PlanApplyPatch): OccupancyInterval | null {
  if (patch.startAt !== undefined && patch.dueAt !== undefined) {
    const start = new Date(patch.startAt);
    const due = new Date(patch.dueAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(due.getTime()) || due.getTime() <= start.getTime()) {
      return null;
    }
    return { start, end: due };
  }
  if (patch.dueYmd !== undefined) return null;
  return occupancyFromTask(row);
}

function toWorkRiskBlock(row: ContinuityProtectedBlockRow): WorkRiskProtectedBlock {
  return {
    kind: row.kind === 'weekly' ? 'weekly' : 'once',
    timezone: row.timezone,
    startAt: row.startAt,
    endAt: row.endAt,
    weekday: row.weekday,
    startHm: row.startHm,
    endHm: row.endHm,
    version: row.version,
  };
}

export function overlappingProtectedLabels(
  occ: OccupancyInterval,
  blocks: readonly ContinuityProtectedBlockRow[],
  zone: string,
): string[] {
  const labels: string[] = [];
  for (const block of blocks) {
    const expanded = expandProtectedBlock(toWorkRiskBlock(block), occ.start, occ.end, zone);
    if (!expanded.some((slot) => intervalsOverlap(occ, slot))) continue;
    if (!labels.includes(block.label)) labels.push(block.label);
  }
  return labels;
}

export function snapshotProtectedBlocks(
  rows: readonly ContinuityProtectedBlockRow[],
): PlanProtectedBlockVersion[] {
  return rows.map((row) => ({ id: row.id, version: row.version, label: row.label }));
}

export function annotateProtectedImpact(
  diffs: ChatPlanDiff[],
  patches: readonly PlanApplyPatch[],
  rows: ReadonlyMap<string, TaskRow>,
  blocks: readonly ContinuityProtectedBlockRow[],
  zone: string,
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const byTask = new Map(diffs.map((diff) => [diff.taskId, diff]));
  for (const patch of patches) {
    const row = rows.get(patch.taskId);
    if (!row || !patchChangesTime(patch)) continue;
    const occ = occupancyFromPatch(row, patch);
    if (!occ) continue;
    const hits = overlappingProtectedLabels(occ, blocks, zone);
    if (hits.length === 0) continue;
    const diff = byTask.get(patch.taskId);
    if (diff) {
      diff.changes.push({
        label: '保护安排',
        before: hits.join('、'),
        after: `与「${hits.join('、')}」重叠，不会占用`,
      });
    }
    for (const label of hits) {
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

function shouldGroup(rowA: TaskRow, a: PlanApplyPatch, rowB: TaskRow, b: PlanApplyPatch): boolean {
  const aMoves = patchChangesTime(a);
  const bMoves = patchChangesTime(b);
  if (!aMoves && !bMoves) return false;
  const aNext = occupancyFromPatch(rowA, a);
  const bNext = occupancyFromPatch(rowB, b);
  const aCur = occupancyFromTask(rowA);
  const bCur = occupancyFromTask(rowB);
  if (aMoves && bMoves && aCur && bNext && intervalsOverlap(aCur, bNext)) return true;
  if (aMoves && bMoves && bCur && aNext && intervalsOverlap(bCur, aNext)) return true;
  if (aNext && bNext && intervalsOverlap(aNext, bNext)) return true;
  return false;
}

export function detectPlanGroups(
  patches: readonly PlanApplyPatch[],
  rows: ReadonlyMap<string, TaskRow>,
): PlanDependencyGroup[] {
  if (patches.length < 2) return [];
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let cur = parent.get(id) ?? id;
    while ((parent.get(cur) ?? cur) !== cur) cur = parent.get(cur) ?? cur;
    parent.set(id, cur);
    return cur;
  };
  const union = (a: string, b: string): void => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };
  for (const patch of patches) parent.set(patch.taskId, patch.taskId);
  for (let i = 0; i < patches.length; i += 1) {
    const a = patches[i];
    const rowA = a ? rows.get(a.taskId) : undefined;
    if (!a || !rowA) continue;
    for (let j = i + 1; j < patches.length; j += 1) {
      const b = patches[j];
      const rowB = b ? rows.get(b.taskId) : undefined;
      if (!b || !rowB) continue;
      if (shouldGroup(rowA, a, rowB, b)) union(a.taskId, b.taskId);
    }
  }
  const buckets = new Map<string, string[]>();
  for (const patch of patches) {
    const root = find(patch.taskId);
    const list = buckets.get(root) ?? [];
    list.push(patch.taskId);
    buckets.set(root, list);
  }
  const groups: PlanDependencyGroup[] = [];
  let n = 0;
  for (const taskIds of buckets.values()) {
    if (taskIds.length < 2) continue;
    n += 1;
    groups.push({ id: `g${String(n)}`, taskIds });
  }
  return groups;
}

function resolveGroups(
  patches: readonly PlanApplyPatch[],
  rows: ReadonlyMap<string, TaskRow>,
  stored?: readonly PlanDependencyGroup[],
): PlanDependencyGroup[] {
  if (stored) return stored.filter((group) => group.taskIds.length > 0);
  return detectPlanGroups(patches, rows);
}

function groupIndex(
  patches: readonly PlanApplyPatch[],
  groups: readonly PlanDependencyGroup[],
): { groupOf: Map<string, string>; members: Map<string, string[]> } {
  const known = new Set(patches.map((patch) => patch.taskId));
  const groupOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const group of groups) {
    const ids = group.taskIds.filter((id) => known.has(id));
    if (ids.length < 2) continue;
    const unique: string[] = [];
    for (const id of ids) {
      if (unique.includes(id)) continue;
      unique.push(id);
      groupOf.set(id, group.id);
    }
    members.set(group.id, unique);
  }
  return { groupOf, members };
}

export async function enqueueContinuityForOutcomes(
  tx: AgentDb,
  userId: string,
  outcomeIds: Iterable<string | null | undefined>,
  now: Date,
): Promise<void> {
  const ids = [...new Set([...outcomeIds].filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: continuityContracts.id, outcomeId: continuityContracts.outcomeId })
    .from(continuityContracts)
    .where(and(eq(continuityContracts.userId, userId), inArray(continuityContracts.outcomeId, ids)));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    await enqueueContinuityRecompute(tx, userId, row.id, now);
  }
}

function evaluatePlanPatch(input: {
  row: TaskRow | undefined;
  patch: PlanApplyPatch;
  zone: string;
  now: Date;
  validOutcomeIds: ReadonlySet<string>;
  protectedBlocks: readonly ContinuityProtectedBlockRow[];
}): PlanCandidate | { reason: string } {
  const { patch, zone, now, validOutcomeIds, protectedBlocks } = input;
  const row = input.row;
  if (!row || row.deletedAt) return { reason: '这条已经不在了' };
  if (row.habitId) return { reason: `「${row.title}」是习惯打卡` };
  if (!samePlanRevision(row.updatedAt, patch.revision)) return { reason: `「${row.title}」这条在方案之后被改过` };
  if (row.calendarKey && (patch.startAt !== undefined || patch.dueYmd !== undefined)) {
    return { reason: `「${row.title}」来自日历，不改时间` };
  }
  if (isRecurring(row) && (patch.dueYmd !== undefined || patch.startAt !== undefined || patch.status === 'done')) {
    return { reason: `「${row.title}」是重复任务，日期和完成不放进方案` };
  }
  if (patch.outcomeId && !validOutcomeIds.has(patch.outcomeId)) {
    return { reason: `「${row.title}」的归属已经不存在` };
  }
  const nextOutcomeId = patch.outcomeId !== undefined ? patch.outcomeId : row.outcomeId;
  if (patch.isMilestone === true && !nextOutcomeId) {
    return { reason: `「${row.title}」没有归属目标，不能标成里程碑` };
  }
  if (patch.status === 'done' && (row.status === 'done' || row.status === 'canceled')) {
    return { reason: row.status === 'done' ? `「${row.title}」已经完成` : `「${row.title}」已取消，不能标完成` };
  }
  if (patch.status && patch.status !== 'done' && row.status === 'done') {
    return { reason: `「${row.title}」已经完成，方案里不能改回` };
  }

  const column: Partial<TaskRow> = { updatedAt: now };
  const previous: Record<string, unknown> = {};
  const fields: { field: string; before: unknown; after: unknown }[] = [];
  let nextDue = row.dueAt;
  if (patch.title !== undefined && patch.title !== row.title) {
    column.title = patch.title;
    previous.title = row.title;
    fields.push({ field: 'title', before: clipTitle(row.title), after: clipTitle(patch.title) });
  }
  if (patch.priority !== undefined && patch.priority !== row.priority) {
    column.priority = patch.priority;
    previous.priority = row.priority;
    fields.push({ field: 'priority', before: row.priority, after: patch.priority });
  }
  if (patch.outcomeId !== undefined && patch.outcomeId !== row.outcomeId) {
    column.outcomeId = patch.outcomeId;
    previous.outcomeId = row.outcomeId;
    fields.push({ field: 'outcomeId', before: row.outcomeId, after: patch.outcomeId });
  }
  if (patch.isMilestone !== undefined && patch.isMilestone !== row.isMilestone) {
    column.isMilestone = patch.isMilestone;
    previous.isMilestone = row.isMilestone;
    fields.push({ field: 'isMilestone', before: row.isMilestone, after: patch.isMilestone });
  }
  if (patch.startAt !== undefined && patch.dueAt !== undefined) {
    const start = new Date(patch.startAt);
    const due = new Date(patch.dueAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(due.getTime()) || due.getTime() <= start.getTime()) {
      return { reason: `「${row.title}」的时段无效` };
    }
    const unchanged =
      sameInstant(start, row.startAt) && sameInstant(due, row.dueAt) && !row.isAllDay && row.agentScheduled;
    if (!unchanged) {
      column.startAt = start;
      column.dueAt = due;
      column.isAllDay = false;
      column.timezone = zone;
      column.agentScheduled = true;
      nextDue = due;
      previous.startAt = row.startAt ? row.startAt.toISOString() : null;
      previous.dueAt = row.dueAt ? row.dueAt.toISOString() : null;
      previous.isAllDay = row.isAllDay;
      previous.timezone = row.timezone;
      previous.agentScheduled = row.agentScheduled;
      fields.push({
        field: 'startAt',
        before: row.startAt ? row.startAt.toISOString() : null,
        after: start.toISOString(),
      });
      fields.push({
        field: 'dueAt',
        before: row.dueAt ? row.dueAt.toISOString() : null,
        after: due.toISOString(),
      });
      if (isDefer(row.dueAt, due, now)) column.deferCount = row.deferCount + 1;
    }
  }
  if (patch.dueYmd !== undefined) {
    const due = patch.dueYmd === null ? null : dueAtFromYmd(patch.dueYmd, zone);
    if (due === null && patch.dueYmd !== null) return { reason: `「${row.title}」的日期无效` };
    if (!sameInstant(due, row.dueAt)) {
      column.dueAt = due;
      column.timezone = zone;
      column.isAllDay = patch.dueYmd === null ? row.isAllDay : true;
      nextDue = due;
      previous.dueAt = row.dueAt ? row.dueAt.toISOString() : null;
      previous.isAllDay = row.isAllDay;
      previous.timezone = row.timezone;
      fields.push({
        field: 'dueAt',
        before: row.dueAt ? row.dueAt.toISOString() : null,
        after: due ? due.toISOString() : null,
      });
      if (due === null && (row.reminderMode === 'due' || row.reminderMode === 'offset')) {
        column.reminderMode = 'none';
        column.reminderOffsetMinutes = null;
        column.reminderAt = null;
        previous.reminderMode = row.reminderMode;
        previous.reminderOffsetMinutes = row.reminderOffsetMinutes;
        previous.reminderAt = row.reminderAt ? row.reminderAt.toISOString() : null;
      }
      if (isDefer(row.dueAt, due, now)) column.deferCount = row.deferCount + 1;
      if (row.agentScheduled) {
        column.agentScheduled = false;
        previous.agentScheduled = true;
      }
    }
  }
  const wantComplete = patch.status === 'done' && row.status !== 'done';
  if (patch.status && patch.status !== 'done' && patch.status !== row.status) {
    column.status = patch.status;
    previous.status = row.status;
    fields.push({ field: 'status', before: row.status, after: patch.status });
  }
  if (wantComplete) {
    fields.push({ field: 'status', before: row.status, after: 'done' });
    if (row.status !== 'todo') previous.status = row.status;
  }
  if (Object.keys(previous).length === 0 && !wantComplete) return { reason: `「${row.title}」没有变化` };

  if (patchChangesTime(patch)) {
    const occ = occupancyFromPatch(row, patch);
    if (occ) {
      const labels = overlappingProtectedLabels(occ, protectedBlocks, zone);
      if (labels[0]) return { reason: `「${row.title}」与保护安排「${labels[0]}」重叠` };
    }
  }

  return { patch, row, column, previous, fields, wantComplete, nextDue };
}

async function writePlanPatch(
  tx: PlanTx,
  user: User,
  userId: string,
  candidate: PlanCandidate,
  now: Date,
): Promise<AppliedPlanItem> {
  const { row, column, previous, fields, wantComplete, nextDue } = candidate;
  await tx.update(tasks).set(column).where(eq(tasks.id, row.id));
  let current: TaskRow = { ...row, ...column, dueAt: nextDue };
  let completionId: string | null = null;
  if (wantComplete) {
    completionId = randomUUID();
    const occurrenceAt = current.dueAt ?? now;
    await tx.insert(taskCompletions).values({
      id: completionId,
      taskId: row.id,
      occurrenceAt,
      completedAt: now,
      dueWasNull: current.dueAt === null,
    });
    await tx
      .update(tasks)
      .set({ status: 'done', completedAt: now, updatedAt: now })
      .where(eq(tasks.id, row.id));
    current = { ...current, status: 'done', completedAt: now, updatedAt: now };
  }
  await recordAgentEdit(tx, userId, row.id, fields);
  await syncTaskNotifications(
    {
      id: current.id,
      userId: current.userId,
      listId: current.listId,
      title: current.title,
      status: current.status,
      dueAt: current.dueAt,
      reminderMode: current.reminderMode,
      reminderOffsetMinutes: current.reminderOffsetMinutes,
      reminderAt: current.reminderAt,
      isAllDay: current.isAllDay,
      timezone: current.timezone,
      deletedAt: current.deletedAt,
      habitId: current.habitId,
      habitSeq: current.habitSeq,
      habitKey: current.habitKey,
      createdAt: current.createdAt,
    },
    user,
    now,
    tx,
  );
  const outcomeIds = new Set<string>();
  if (row.outcomeId) outcomeIds.add(row.outcomeId);
  if (current.outcomeId) outcomeIds.add(current.outcomeId);
  for (const outcomeId of outcomeIds) await enqueueOutcomeRefresh(tx, userId, outcomeId, now);
  if (
    column.deferCount !== undefined &&
    needsDecomposition(column.deferCount) &&
    !(await hasPendingDecomposeAction(tx, row.id, userId))
  ) {
    await enqueueTaskDecompose(tx, userId, row.id, now);
  }
  if (wantComplete) {
    await enqueueTodayLayout(tx, userId, now, 'complete');
    await syncContinuityOnTaskComplete(tx, userId, current, now);
  }

  const steps: PlanStep[] = [];
  if (completionId) steps.push({ kind: 'uncomplete', taskId: row.id, completionId });
  if (Object.keys(previous).length > 0) steps.push({ kind: 'patch_task', taskId: row.id, previous });
  const summary = wantComplete ? `已完成「${current.title}」` : `已更新「${current.title}」`;
  return {
    taskId: row.id,
    title: current.title,
    summary,
    steps,
    afterRevision: now.toISOString(),
    indexed: current,
  };
}

function findViolations(
  candidates: readonly PlanCandidate[],
  leftover: ReadonlyMap<string, TaskRow>,
  blocks: readonly ContinuityProtectedBlockRow[],
  zone: string,
): Map<string, string> {
  const bad = new Map<string, string>();
  const slots = candidates.map((candidate) => ({
    taskId: candidate.patch.taskId,
    title: candidate.row.title,
    occ: occupancyFromPatch(candidate.row, candidate.patch),
    moves: patchChangesTime(candidate.patch),
  }));
  for (let i = 0; i < slots.length; i += 1) {
    const a = slots[i];
    if (!a?.occ) continue;
    const labels = overlappingProtectedLabels(a.occ, blocks, zone);
    if (labels[0]) bad.set(a.taskId, `「${a.title}」与保护安排「${labels[0]}」重叠`);
    for (let j = i + 1; j < slots.length; j += 1) {
      const b = slots[j];
      if (!b?.occ || !intervalsOverlap(a.occ, b.occ)) continue;
      if (a.moves) bad.set(a.taskId, `「${a.title}」和另一条改动抢同一时段`);
      if (b.moves) bad.set(b.taskId, `「${b.title}」和另一条改动抢同一时段`);
    }
    for (const row of leftover.values()) {
      const occ = occupancyFromTask(row);
      if (!occ || !intervalsOverlap(a.occ, occ) || !a.moves) continue;
      bad.set(a.taskId, `「${a.title}」会与现有安排重叠`);
    }
  }
  return bad;
}

/**
 * Apply a single patch inside an open transaction. Locks the row.
 * Callers that already hold the lock should prefer evaluate + write via applyPlanPatches.
 */
export async function applyOnePlanPatch(
  tx: PlanTx,
  input: Omit<ApplyPlanPatchesInput, 'patches' | 'groups'> & { patch: PlanApplyPatch },
): Promise<AppliedPlanItem | { reason: string }> {
  const result = await applyPlanPatches(tx, {
    user: input.user,
    userId: input.userId,
    timezone: input.timezone,
    patches: [input.patch],
    now: input.now,
  });
  return result.applied[0] ?? result.skipped[0] ?? { reason: '没有改动' };
}

/** Apply many patches in the caller's transaction. Groups are all-or-nothing; independent rows may skip. */
export async function applyPlanPatches(tx: PlanTx, input: ApplyPlanPatchesInput): Promise<ApplyPlanPatchesResult> {
  const { user, userId, timezone, patches, now } = input;
  if (patches.length === 0) return { applied: [], skipped: [] };

  const ids = [...new Set(patches.map((patch) => patch.taskId))].sort();
  const locked =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)))
          .for('update');
  const byId = new Map(locked.map((row) => [row.id, row]));
  const blocks = await tx
    .select()
    .from(continuityProtectedBlocks)
    .where(eq(continuityProtectedBlocks.userId, userId))
    .for('update');

  const outcomeIds = new Set<string>();
  for (const row of locked) if (row.outcomeId) outcomeIds.add(row.outcomeId);
  for (const patch of patches) if (patch.outcomeId) outcomeIds.add(patch.outcomeId);
  const validOutcomeIds = new Set<string>();
  if (outcomeIds.size > 0) {
    const found = await tx
      .select({ id: outcomes.id })
      .from(outcomes)
      .where(and(eq(outcomes.userId, userId), inArray(outcomes.id, [...outcomeIds])));
    for (const outcome of found) validOutcomeIds.add(outcome.id);
  }

  const groups = resolveGroups(patches, byId, input.groups);
  const { groupOf, members } = groupIndex(patches, groups);

  const evaluated = new Map<string, PlanCandidate | { reason: string }>();
  for (const patch of patches) {
    evaluated.set(
      patch.taskId,
      evaluatePlanPatch({
        row: byId.get(patch.taskId),
        patch,
        zone: timezone,
        now,
        validOutcomeIds,
        protectedBlocks: blocks,
      }),
    );
  }

  const skipped: { taskId: string; reason: string }[] = [];
  const processed = new Set<string>();
  let candidates: PlanCandidate[] = [];

  const skipIds = (taskIds: readonly string[], failed: { taskId: string; reason: string }[]): void => {
    const primary = failed[0]?.reason ?? '依赖组无法应用';
    for (const taskId of taskIds) {
      const own = failed.find((item) => item.taskId === taskId);
      skipped.push({ taskId, reason: own?.reason ?? `依赖组未应用：${primary}` });
    }
  };

  for (const patch of patches) {
    if (processed.has(patch.taskId)) continue;
    const gid = groupOf.get(patch.taskId);
    if (gid) {
      const groupIds = members.get(gid) ?? [patch.taskId];
      const failed: { taskId: string; reason: string }[] = [];
      for (const taskId of groupIds) {
        const one = evaluated.get(taskId);
        if (one && 'reason' in one) failed.push({ taskId, reason: one.reason });
      }
      if (failed.length > 0) skipIds(groupIds, failed);
      else {
        for (const taskId of groupIds) {
          const one = evaluated.get(taskId);
          if (one && !('reason' in one)) candidates.push(one);
        }
      }
      for (const taskId of groupIds) processed.add(taskId);
      continue;
    }
    const one = evaluated.get(patch.taskId);
    if (!one) continue;
    if ('reason' in one) skipped.push({ taskId: patch.taskId, reason: one.reason });
    else candidates.push(one);
    processed.add(patch.taskId);
  }

  while (candidates.length > 0) {
    const leftover = new Map<string, TaskRow>();
    const appliedIds = new Set(candidates.map((item) => item.patch.taskId));
    for (const patch of patches) {
      if (appliedIds.has(patch.taskId)) continue;
      const row = byId.get(patch.taskId);
      if (row) leftover.set(row.id, row);
    }
    const bad = findViolations(candidates, leftover, blocks, timezone);
    if (bad.size === 0) break;
    const drop = new Set<string>();
    for (const taskId of bad.keys()) {
      const gid = groupOf.get(taskId);
      if (gid) for (const member of members.get(gid) ?? [taskId]) drop.add(member);
      else drop.add(taskId);
    }
    const failed = [...bad.entries()].map(([taskId, reason]) => ({ taskId, reason }));
    skipIds([...drop], failed);
    candidates = candidates.filter((item) => !drop.has(item.patch.taskId));
  }

  const applied: AppliedPlanItem[] = [];
  if (candidates.length > 0) {
    await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
  }
  for (const candidate of candidates) {
    applied.push(await writePlanPatch(tx, user, userId, candidate, now));
  }

  const contractOutcomes = new Set<string>();
  for (const item of applied) {
    if (item.indexed.outcomeId) contractOutcomes.add(item.indexed.outcomeId);
    const prior = byId.get(item.taskId);
    if (prior?.outcomeId) contractOutcomes.add(prior.outcomeId);
  }
  await enqueueContinuityForOutcomes(tx, userId, contractOutcomes, now);

  return { applied, skipped };
}

export async function loadProtectedBlocks(userId: string): Promise<ContinuityProtectedBlockRow[]> {
  return getDb().select().from(continuityProtectedBlocks).where(eq(continuityProtectedBlocks.userId, userId));
}
