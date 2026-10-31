import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, lte, or } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { ExplorationWindow, ExplorationWindowList } from '@vital/dto';
import { getUserEntity } from '../auth/auth.service.js';
import { getDb } from '../db/index.js';
import {
  continuityUserSettings,
  explorationWindows,
  holidayCalendar,
  holidayCalendarSources,
  type ExplorationWindowRow,
  type HolidayCalendarSourceRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { insertFixtureProposals } from './exploration-verify.js';

export const EXPLORATION_HORIZON_DAYS = 10;
const SCAN_PAD_DAYS = 16;
const MIN_FREE_DAYS = 2;

let nowForTest: Date | null = null;

/** Test seam so GET /windows can list fixtures that are not on the real calendar. */
export function setExplorationNowForTest(value: Date | null): void {
  nowForTest = value;
}

function resolveNow(now?: Date): Date {
  return now ?? nowForTest ?? new Date();
}

export type CalendarDayKind = 'holiday' | 'workday';
export type ExplorationWindowKind = 'holiday' | 'weekend' | 'idle';

export interface PlannedExplorationWindow {
  windowKey: string;
  kind: ExplorationWindowKind;
  startDate: string;
  endDate: string;
  region: string | null;
  calendarVersion: string;
}

export interface PlanExplorationWindowsInput {
  todayYmd: string;
  timezone: string;
  region: string | null;
  explorationWeekend: boolean;
  explorationHoliday: boolean;
  idleDates: readonly string[];
  /** Dates inside source coverage only. */
  calendar: ReadonlyMap<string, CalendarDayKind>;
  coverageFrom: string | null;
  coverageTo: string | null;
  sourceVersion: string;
  existingWeekend: readonly { windowKey: string; startDate: string }[];
}

function ymdInZone(now: Date, timezone: string): string {
  const ymd = DateTime.fromJSDate(now).setZone(timezone).toISODate();
  if (!ymd) throw new Error('invalid local date');
  return ymd;
}

function addDays(ymd: string, days: number, timezone: string): string {
  const next = DateTime.fromISO(ymd, { zone: timezone }).startOf('day').plus({ days }).toISODate();
  if (!next) throw new Error('invalid local date');
  return next;
}

function eachYmd(from: string, to: string, timezone: string): string[] {
  const out: string[] = [];
  let cursor = DateTime.fromISO(from, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(to, { zone: timezone }).startOf('day');
  if (!cursor.isValid || !end.isValid || cursor > end) return out;
  while (cursor <= end) {
    const ymd = cursor.toISODate();
    if (ymd) out.push(ymd);
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

function inclusiveDays(start: string, end: string, timezone: string): number {
  return (
    DateTime.fromISO(end, { zone: timezone })
      .startOf('day')
      .diff(DateTime.fromISO(start, { zone: timezone }).startOf('day'), 'days').days + 1
  );
}

function isWeekend(ymd: string, timezone: string): boolean {
  const day = DateTime.fromISO(ymd, { zone: timezone });
  return day.isValid && day.weekday >= 6;
}

function monthKey(ymd: string, timezone: string): string {
  return DateTime.fromISO(ymd, { zone: timezone }).toFormat('yyyy-LL');
}

function dateCovered(ymd: string, from: string | null, to: string | null): boolean {
  if (!from || !to) return false;
  return from <= ymd && ymd <= to;
}

function isFreeDay(ymd: string, input: PlanExplorationWindowsInput, idle: ReadonlySet<string>): boolean {
  if (idle.has(ymd)) return true;
  const weekend = isWeekend(ymd, input.timezone);
  if (input.region && dateCovered(ymd, input.coverageFrom, input.coverageTo)) {
    const kind = input.calendar.get(ymd);
    if (kind === 'workday') return false;
    if (kind === 'holiday') return true;
    return weekend;
  }
  return weekend && input.explorationWeekend;
}

function classifyCluster(
  start: string,
  end: string,
  input: PlanExplorationWindowsInput,
  idle: ReadonlySet<string>,
): ExplorationWindowKind {
  const days = eachYmd(start, end, input.timezone);
  if (days.length > 0 && days.every((ymd) => idle.has(ymd))) return 'idle';
  if (days.some((ymd) => input.calendar.get(ymd) === 'holiday')) return 'holiday';
  if (days.every((ymd) => isWeekend(ymd, input.timezone))) return 'weekend';
  if (days.some((ymd) => idle.has(ymd))) return 'idle';
  return 'weekend';
}

function windowKeyOf(
  kind: ExplorationWindowKind,
  region: string | null,
  start: string,
  end: string,
): string {
  if (kind === 'holiday') return `holiday:${region ?? 'ZZ'}:${start}:${end}`;
  return `${kind}:${start}:${end}`;
}

function applyWeekendMonthCap(
  planned: PlannedExplorationWindow[],
  existingWeekend: readonly { windowKey: string; startDate: string }[],
  timezone: string,
): PlannedExplorationWindow[] {
  const ownerByMonth = new Map<string, string>();
  for (const row of existingWeekend) {
    ownerByMonth.set(monthKey(row.startDate, timezone), row.windowKey);
  }
  const rest: PlannedExplorationWindow[] = [];
  const weekends = planned
    .filter((row) => row.kind === 'weekend')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const row of planned) {
    if (row.kind !== 'weekend') rest.push(row);
  }
  const keptWeekend: PlannedExplorationWindow[] = [];
  const takenThisPass = new Set<string>();
  for (const row of weekends) {
    const month = monthKey(row.startDate, timezone);
    const owner = ownerByMonth.get(month);
    if (owner && owner !== row.windowKey) continue;
    if (!owner && takenThisPass.has(month)) continue;
    keptWeekend.push(row);
    takenThisPass.add(month);
  }
  return [...rest, ...keptWeekend];
}

/** Pure planner: consecutive ≥2 free days, 10-day horizon, weekend cap, no CN guess without region+coverage. */
export function planExplorationWindows(input: PlanExplorationWindowsInput): PlannedExplorationWindow[] {
  const idle = new Set(input.idleDates);
  const scanStart = addDays(input.todayYmd, -SCAN_PAD_DAYS, input.timezone);
  const scanEnd = addDays(input.todayYmd, EXPLORATION_HORIZON_DAYS + SCAN_PAD_DAYS, input.timezone);
  const horizonEnd = addDays(input.todayYmd, EXPLORATION_HORIZON_DAYS, input.timezone);
  const planned: PlannedExplorationWindow[] = [];
  let runStart: string | null = null;
  let runEnd: string | null = null;
  const flush = (): void => {
    if (!runStart || !runEnd) return;
    if (inclusiveDays(runStart, runEnd, input.timezone) >= MIN_FREE_DAYS) {
      const kind = classifyCluster(runStart, runEnd, input, idle);
      if (kind === 'holiday' && (!input.explorationHoliday || !input.region)) {
        runStart = null;
        runEnd = null;
        return;
      }
      if (kind === 'weekend' && !input.explorationWeekend) {
        runStart = null;
        runEnd = null;
        return;
      }
      planned.push({
        windowKey: windowKeyOf(kind, input.region, runStart, runEnd),
        kind,
        startDate: runStart,
        endDate: runEnd,
        region: input.region,
        calendarVersion: input.sourceVersion,
      });
    }
    runStart = null;
    runEnd = null;
  };
  for (const ymd of eachYmd(scanStart, scanEnd, input.timezone)) {
    if (isFreeDay(ymd, input, idle)) {
      if (!runStart) runStart = ymd;
      runEnd = ymd;
    } else {
      flush();
    }
  }
  flush();
  const inHorizon = planned.filter(
    (row) => row.endDate >= input.todayYmd && row.startDate <= horizonEnd,
  );
  return applyWeekendMonthCap(inHorizon, input.existingWeekend, input.timezone);
}

function toDto(row: ExplorationWindowRow): ExplorationWindow {
  return {
    id: row.id,
    windowKey: row.windowKey,
    startDate: row.startDate,
    endDate: row.endDate,
    timezone: row.timezone,
    region: row.region ?? null,
    calendarVersion: row.calendarVersion,
    status: row.status,
    closedReason: row.closedReason ?? null,
    generatedAt: row.generatedAt.toISOString(),
  };
}

function upcomingWhere(userId: string, todayYmd: string) {
  return and(eq(explorationWindows.userId, userId), gte(explorationWindows.endDate, todayYmd));
}

async function loadOwnedWindow(userId: string, id: string): Promise<ExplorationWindowRow> {
  const [row] = await getDb()
    .select()
    .from(explorationWindows)
    .where(and(eq(explorationWindows.id, id), eq(explorationWindows.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

export async function listExplorationWindows(
  userId: string,
  now = resolveNow(),
): Promise<ExplorationWindowList> {
  const user = await getUserEntity(userId);
  const todayYmd = ymdInZone(now, user.timezone);
  const rows = await getDb()
    .select()
    .from(explorationWindows)
    .where(upcomingWhere(userId, todayYmd))
    .orderBy(asc(explorationWindows.startDate), asc(explorationWindows.windowKey));
  return { items: rows.map(toDto) };
}

export async function getExplorationWindow(
  userId: string,
  id: string,
): Promise<ExplorationWindow> {
  await getUserEntity(userId);
  return toDto(await loadOwnedWindow(userId, id));
}

export async function restExplorationWindow(userId: string, id: string): Promise<ExplorationWindow> {
  await getUserEntity(userId);
  const existing = await loadOwnedWindow(userId, id);
  if (existing.status === 'rest') return toDto(existing);
  const [updated] = await getDb()
    .update(explorationWindows)
    .set({ status: 'rest', closedReason: 'rest' })
    .where(and(eq(explorationWindows.id, existing.id), eq(explorationWindows.userId, userId)))
    .returning();
  if (!updated) throw AppError.of(404, 'NOT_FOUND');
  return toDto(updated);
}

export async function generateExplorationWindows(
  userId: string,
  now: Date,
  opts: { idleDates?: readonly string[] } = {},
): Promise<ExplorationWindow[]> {
  const user = await getUserEntity(userId);
  const timezone = user.timezone;
  const todayYmd = ymdInZone(now, timezone);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(continuityUserSettings)
      .where(eq(continuityUserSettings.userId, userId))
      .limit(1)
      .for('update');
    const explorationWeekend = settings?.explorationWeekend ?? false;
    const explorationHoliday = settings?.explorationHoliday ?? false;
    const region = settings?.region ?? null;
    const idleDates = opts.idleDates ?? [];
    const existing = await tx
      .select()
      .from(explorationWindows)
      .where(eq(explorationWindows.userId, userId));
    if (!explorationWeekend && !explorationHoliday && idleDates.length === 0) {
      return existing
        .filter((row) => row.endDate >= todayYmd)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.windowKey.localeCompare(b.windowKey))
        .map(toDto);
    }
    const scanStart = addDays(todayYmd, -SCAN_PAD_DAYS, timezone);
    const scanEnd = addDays(todayYmd, EXPLORATION_HORIZON_DAYS + SCAN_PAD_DAYS, timezone);
    let source: HolidayCalendarSourceRow | undefined;
    const calendar = new Map<string, CalendarDayKind>();
    if (region) {
      const [sourceRow] = await tx
        .select()
        .from(holidayCalendarSources)
        .where(eq(holidayCalendarSources.region, region))
        .limit(1);
      source = sourceRow;
      if (source?.coverageFrom && source.coverageTo) {
        const rows = await tx
          .select({
            date: holidayCalendar.date,
            kind: holidayCalendar.kind,
            sourceVersion: holidayCalendar.sourceVersion,
          })
          .from(holidayCalendar)
          .where(
            and(
              eq(holidayCalendar.region, region),
              gte(holidayCalendar.date, scanStart),
              lte(holidayCalendar.date, scanEnd),
            ),
          );
        for (const row of rows) {
          if (!dateCovered(row.date, source.coverageFrom, source.coverageTo)) continue;
          if (row.kind === 'holiday' || row.kind === 'workday') calendar.set(row.date, row.kind);
        }
      }
    }
    const planned = planExplorationWindows({
      todayYmd,
      timezone,
      region,
      explorationWeekend,
      explorationHoliday,
      idleDates,
      calendar,
      coverageFrom: source?.coverageFrom ?? null,
      coverageTo: source?.coverageTo ?? null,
      sourceVersion: source?.sourceVersion ?? '',
      existingWeekend: existing
        .filter((row) => row.windowKey.startsWith('weekend:'))
        .map((row) => ({ windowKey: row.windowKey, startDate: row.startDate })),
    });
    const byKey = new Map(existing.map((row) => [row.windowKey, row]));
    for (const candidate of planned) {
      const found = byKey.get(candidate.windowKey);
      if (!found) {
        const [inserted] = await tx
          .insert(explorationWindows)
          .values({
            id: randomUUID(),
            userId,
            windowKey: candidate.windowKey,
            startDate: candidate.startDate,
            endDate: candidate.endDate,
            timezone,
            region: candidate.region,
            calendarVersion: candidate.calendarVersion,
            status: 'open',
            closedReason: null,
            generatedAt: now,
          })
          .returning();
        if (inserted) {
          byKey.set(inserted.windowKey, inserted);
          if (explorationHoliday || explorationWeekend) {
            await insertFixtureProposals(tx, { userId, window: inserted, now, place: null });
          }
        }
        continue;
      }
      if (found.status === 'open') {
        const [updated] = await tx
          .update(explorationWindows)
          .set({
            startDate: candidate.startDate,
            endDate: candidate.endDate,
            timezone,
            region: candidate.region,
            calendarVersion: candidate.calendarVersion,
          })
          .where(eq(explorationWindows.id, found.id))
          .returning();
        if (updated) byKey.set(updated.windowKey, updated);
        continue;
      }
      const [updated] = await tx
        .update(explorationWindows)
        .set({ calendarVersion: candidate.calendarVersion })
        .where(eq(explorationWindows.id, found.id))
        .returning();
      if (updated) byKey.set(updated.windowKey, updated);
    }
    return [...byKey.values()]
      .filter((row) => row.endDate >= todayYmd)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.windowKey.localeCompare(b.windowKey))
      .map(toDto);
  });
}

/** Catch-up for users who turned exploration on. Invoked from runAgentScheduler — no new job type. */
export async function generateDueExplorationWindows(now = resolveNow()): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ userId: continuityUserSettings.userId })
    .from(continuityUserSettings)
    .where(
      or(
        eq(continuityUserSettings.explorationWeekend, true),
        eq(continuityUserSettings.explorationHoliday, true),
      ),
    );
  let n = 0;
  for (const row of rows) {
    await generateExplorationWindows(row.userId, now);
    n += 1;
  }
  return n;
}
