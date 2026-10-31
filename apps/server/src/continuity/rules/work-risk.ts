import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { eachYmd, localYmd, weekdayOfYmd, zonedDateTime } from './clock.js';

export const WORK_RISK_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WORK_RISK_UNCONFIRMED = '风险待确认';

const PACK_HORIZON_DAYS = 60;

export type WorkRiskKind = 'ok' | 'risk' | 'unconfirmed';
export type WorkRiskMissing = 'estimate' | 'due' | 'dependency_time' | 'calendar';

export interface OccupancyInterval {
  start: Date;
  end: Date;
}

export interface WorkHours {
  startHm: string;
  endHm: string;
}

export interface WorkRiskProtectedBlock {
  kind: 'once' | 'weekly';
  timezone: string;
  startAt: Date | null;
  endAt: Date | null;
  weekday: number | null;
  startHm: string | null;
  endHm: string | null;
  version?: number;
}

export interface WorkRiskDependency {
  id: string;
  prerequisiteType: 'task' | 'outcome' | 'external';
  expectedUnblockAt: Date | null;
}

export interface EvaluateWorkRiskInput {
  remainingMinutes: number | null;
  dueAt: Date | null;
  workHours: WorkHours;
  timezone: string;
  occupancy: readonly OccupancyInterval[];
  protectedBlocks: readonly WorkRiskProtectedBlock[];
  openDependencies: readonly WorkRiskDependency[];
  splitAllowed: boolean;
  now: Date;
}

export interface WorkRiskDecision {
  kind: WorkRiskKind;
  missing: WorkRiskMissing[];
  latestStartAt: Date | null;
  latestUnblockAt: Date | null;
  facts: string[];
  whyNow: string;
}

/** All-day rows do not occupy a work window — same rule as busyBlock. */
export function occupancyFromTask(row: {
  isAllDay: boolean;
  startAt: Date | null;
  dueAt: Date | null;
  calendarEndAt: Date | null;
}): OccupancyInterval | null {
  if (row.isAllDay) return null;
  const start = row.startAt ?? row.dueAt;
  if (!start) return null;
  const end =
    row.calendarEndAt && row.calendarEndAt.getTime() > start.getTime()
      ? row.calendarEndAt
      : row.dueAt && row.dueAt.getTime() > start.getTime()
        ? row.dueAt
        : null;
  if (!end) return null;
  return { start, end };
}

export function isWorkRiskWorthShowing(decision: WorkRiskDecision, input: EvaluateWorkRiskInput): boolean {
  if (decision.kind === 'ok') return false;
  if (decision.kind === 'risk') return true;
  return (
    input.dueAt !== null ||
    input.remainingMinutes !== null ||
    input.openDependencies.length > 0
  );
}

export function workRiskFactFingerprint(input: {
  kind: WorkRiskKind;
  missing: readonly WorkRiskMissing[];
  latestStartAt: Date | null;
  latestUnblockAt: Date | null;
  remainingMinutes: number | null;
  dueAt: Date | null;
  occupancy: readonly OccupancyInterval[];
  openDependencyIds: readonly string[];
  splitAllowed: boolean;
  protectedVersions: readonly number[];
}): string {
  const occupancy = [...input.occupancy]
    .map((row) => `${String(row.start.getTime())}:${String(row.end.getTime())}`)
    .sort();
  const material = JSON.stringify({
    kind: input.kind,
    missing: [...input.missing].sort(),
    latestStartAt: input.latestStartAt?.toISOString() ?? null,
    latestUnblockAt: input.latestUnblockAt?.toISOString() ?? null,
    remainingMinutes: input.remainingMinutes,
    dueAt: input.dueAt?.toISOString() ?? null,
    occupancy,
    deps: [...input.openDependencyIds].sort(),
    splitAllowed: input.splitAllowed,
    protected: [...input.protectedVersions].sort((a, b) => a - b),
  });
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export function evaluateWorkRisk(input: EvaluateWorkRiskInput): WorkRiskDecision {
  const missing: WorkRiskMissing[] = [];
  if (input.remainingMinutes === null) missing.push('estimate');
  if (input.dueAt === null) missing.push('due');
  if (!validWorkHours(input.workHours)) missing.push('calendar');
  const unknownDeps = input.openDependencies.filter((row) => row.expectedUnblockAt === null);
  if (unknownDeps.length > 0) missing.push('dependency_time');

  if (input.remainingMinutes === 0) {
    return {
      kind: 'ok',
      missing: [],
      latestStartAt: null,
      latestUnblockAt: null,
      facts: [],
      whyNow: '',
    };
  }

  let latestStartAt: Date | null = null;
  if (
    input.remainingMinutes !== null &&
    input.remainingMinutes > 0 &&
    input.dueAt &&
    validWorkHours(input.workHours)
  ) {
    latestStartAt = packLatestStart(input);
  }

  const latestUnblockAt =
    input.openDependencies.length > 0 && latestStartAt ? latestStartAt : null;

  if (missing.length > 0) {
    return {
      kind: 'unconfirmed',
      missing,
      latestStartAt,
      latestUnblockAt,
      facts: unconfirmedFacts(missing, input),
      whyNow: WORK_RISK_UNCONFIRMED,
    };
  }

  if (!latestStartAt) {
    return {
      kind: 'risk',
      missing: [],
      latestStartAt: null,
      latestUnblockAt,
      facts: remainingFacts(input),
      whyNow: input.splitAllowed
        ? '按你记录的工作量，现有空档装不下这段工作。'
        : '按你记录的工作量，现有连续空档装不下这段工作。',
    };
  }

  const remainingMs = latestStartAt.getTime() - input.now.getTime();
  if (remainingMs < WORK_RISK_WINDOW_MS) {
    return {
      kind: 'risk',
      missing: [],
      latestStartAt,
      latestUnblockAt,
      facts: remainingFacts(input),
      whyNow: riskWhyNow(latestStartAt, input.now, input.timezone),
    };
  }

  return {
    kind: 'ok',
    missing: [],
    latestStartAt,
    latestUnblockAt,
    facts: [],
    whyNow: '',
  };
}

function validWorkHours(hours: WorkHours): boolean {
  const start = hmToMinutes(hours.startHm);
  const end = hmToMinutes(hours.endHm);
  return start !== null && end !== null && end > start;
}

function hmToMinutes(hm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function remainingFacts(input: EvaluateWorkRiskInput): string[] {
  const facts: string[] = [];
  if (input.remainingMinutes !== null && input.remainingMinutes > 0) {
    facts.push(`剩余约 ${String(input.remainingMinutes)} 分钟`);
  }
  if (input.dueAt) {
    facts.push(`交付时间 ${formatLocal(input.dueAt, input.timezone)}`);
  }
  return facts;
}

function unconfirmedFacts(missing: readonly WorkRiskMissing[], input: EvaluateWorkRiskInput): string[] {
  const facts: string[] = [];
  if (missing.includes('estimate')) facts.push('还没有记录剩余工作估时');
  if (missing.includes('due')) facts.push('还没有记录交付日期');
  if (missing.includes('dependency_time')) facts.push('依赖尚未解除，解除时间待确认');
  if (missing.includes('calendar')) facts.push('可工作时段还不明确');
  if (input.remainingMinutes !== null && input.remainingMinutes > 0) {
    facts.push(`已记录估时 ${String(input.remainingMinutes)} 分钟`);
  }
  if (input.dueAt) facts.push(`交付时间 ${formatLocal(input.dueAt, input.timezone)}`);
  return facts;
}

function riskWhyNow(latestStartAt: Date, now: Date, timezone: string): string {
  if (latestStartAt.getTime() < now.getTime()) {
    return '最晚启动窗口已过，建议下一步。';
  }
  return `按你记录的工作量，${formatLocal(latestStartAt, timezone)} 是开始的最晚窗口。`;
}

function formatLocal(value: Date, timezone: string): string {
  return DateTime.fromJSDate(value, { zone: timezone }).toFormat('M月d日 H:mm');
}

function packLatestStart(input: EvaluateWorkRiskInput): Date | null {
  const dueAt = input.dueAt;
  const remaining = input.remainingMinutes;
  if (!dueAt || remaining === null || remaining <= 0) return null;
  const until = dueAt;
  const from = DateTime.fromJSDate(until, { zone: input.timezone })
    .minus({ days: PACK_HORIZON_DAYS })
    .toJSDate();
  const protectedOcc = input.protectedBlocks.flatMap((block) =>
    expandProtectedBlock(block, from, until, input.timezone),
  );
  const occupancy = [...input.occupancy, ...protectedOcc];
  const windows = workWindows(from, until, input.workHours, input.timezone);
  const free = subtractAll(windows, occupancy);
  return packInto(free, remaining, input.splitAllowed);
}

export function expandProtectedBlock(
  block: WorkRiskProtectedBlock,
  from: Date,
  until: Date,
  fallbackTimezone: string,
): OccupancyInterval[] {
  const zone = block.timezone || fallbackTimezone;
  if (block.kind === 'once' && block.startAt && block.endAt) {
    if (block.endAt.getTime() <= block.startAt.getTime()) return [];
    return [{ start: block.startAt, end: block.endAt }];
  }
  if (
    block.kind === 'weekly' &&
    block.weekday !== null &&
    block.startHm &&
    block.endHm
  ) {
    const startYmd = localYmd(from, zone);
    const endYmd = localYmd(until, zone);
    const out: OccupancyInterval[] = [];
    for (const ymd of eachYmd(startYmd, endYmd)) {
      if (weekdayOfYmd(ymd) !== block.weekday) continue;
      const start = zonedDateTime(ymd, block.startHm, zone);
      const end = zonedDateTime(ymd, block.endHm, zone);
      if (end.getTime() <= start.getTime()) continue;
      if (end.getTime() <= from.getTime() || start.getTime() >= until.getTime()) continue;
      out.push({ start, end });
    }
    return out;
  }
  return [];
}

function workWindows(
  from: Date,
  until: Date,
  workHours: WorkHours,
  timezone: string,
): OccupancyInterval[] {
  const startYmd = localYmd(from, timezone);
  const endYmd = localYmd(until, timezone);
  const out: OccupancyInterval[] = [];
  for (const ymd of eachYmd(startYmd, endYmd)) {
    const start = zonedDateTime(ymd, workHours.startHm, timezone);
    const end = zonedDateTime(ymd, workHours.endHm, timezone);
    if (end.getTime() <= start.getTime()) continue;
    const clippedStart = start.getTime() < from.getTime() ? from : start;
    const clippedEnd = end.getTime() > until.getTime() ? until : end;
    if (clippedEnd.getTime() <= clippedStart.getTime()) continue;
    out.push({ start: clippedStart, end: clippedEnd });
  }
  return out;
}

function subtractAll(
  free: readonly OccupancyInterval[],
  occupancy: readonly OccupancyInterval[],
): OccupancyInterval[] {
  let current = [...free];
  for (const occ of occupancy) {
    current = current.flatMap((slot) => subtractOne(slot, occ));
  }
  return current
    .filter((slot) => slot.end.getTime() > slot.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function subtractOne(free: OccupancyInterval, occ: OccupancyInterval): OccupancyInterval[] {
  const fs = free.start.getTime();
  const fe = free.end.getTime();
  const os = occ.start.getTime();
  const oe = occ.end.getTime();
  if (oe <= fs || os >= fe) return [free];
  const out: OccupancyInterval[] = [];
  if (os > fs) out.push({ start: free.start, end: new Date(Math.min(os, fe)) });
  if (oe < fe) out.push({ start: new Date(Math.max(oe, fs)), end: free.end });
  return out;
}

function minutesOf(slot: OccupancyInterval): number {
  return Math.max(0, (slot.end.getTime() - slot.start.getTime()) / 60_000);
}

function packInto(
  free: readonly OccupancyInterval[],
  minutes: number,
  splitAllowed: boolean,
): Date | null {
  const slots = free.filter((slot) => minutesOf(slot) > 0);
  if (slots.length === 0) return null;
  if (splitAllowed) {
    let left = minutes;
    for (let i = slots.length - 1; i >= 0; i -= 1) {
      const slot = slots[i];
      if (!slot) continue;
      const avail = minutesOf(slot);
      if (avail >= left) return new Date(slot.end.getTime() - left * 60_000);
      left -= avail;
    }
    return null;
  }
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    const slot = slots[i];
    if (!slot) continue;
    if (minutesOf(slot) >= minutes) return new Date(slot.end.getTime() - minutes * 60_000);
  }
  return null;
}
