import { randomUUID } from 'node:crypto';
import type { CreateEnergyLogInput, EnergyLog, EnergyLogList, EnergyLogQuery } from '@vital/dto';
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getDb } from '../db/index.js';
import { energyLogs, taskCompletions, tasks } from '../db/schema.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { ENERGY_LOW_MAX, type EnergyDayLink } from '../notifications/energy-link.js';

const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_RANGE_DAYS = 31;

function localYmd(instant: Date, timeZone: string): string | null {
  const local = DateTime.fromJSDate(instant, { zone: 'utc' }).setZone(timeZone);
  if (!local.isValid) return null;
  return local.toISODate();
}

function dayStart(ymd: string, timeZone: string): DateTime {
  return DateTime.fromISO(ymd, { zone: timeZone }).startOf('day');
}

function toDto(row: {
  id: string;
  energy: number;
  mood: string | null;
  note: string | null;
  loggedAt: Date;
  createdAt: Date;
}): EnergyLog {
  return {
    id: row.id,
    energy: row.energy,
    mood: row.mood,
    note: row.note,
    loggedAt: row.loggedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createEnergyLog(
  userId: string,
  input: CreateEnergyLogInput,
  now = new Date(),
): Promise<EnergyLog> {
  let loggedAt = now;
  if (input.loggedAt !== undefined) {
    const parsed = new Date(input.loggedAt);
    if (!Number.isFinite(parsed.getTime())) throw AppError.of(400, 'VALIDATION_ERROR');
    if (parsed.getTime() > now.getTime() + FUTURE_SKEW_MS) throw AppError.of(400, 'VALIDATION_ERROR');
    loggedAt = parsed;
  }
  const [row] = await getDb()
    .insert(energyLogs)
    .values({
      id: randomUUID(),
      userId,
      energy: input.energy,
      mood: input.mood ?? null,
      note: input.note ?? null,
      loggedAt,
      createdAt: now,
    })
    .returning();
  if (!row) throw new Error('energy log missing after insert');
  return toDto(row);
}

function rangeOf(query: EnergyLogQuery, timeZone: string, now: Date): { start: Date; end: Date } {
  if (query.date) {
    const start = dayStart(query.date, timeZone);
    if (!start.isValid) throw AppError.of(400, 'VALIDATION_ERROR');
    return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
  }
  if (query.from && query.to) {
    const start = dayStart(query.from, timeZone);
    const end = dayStart(query.to, timeZone);
    if (!start.isValid || !end.isValid || end < start) throw AppError.of(400, 'VALIDATION_ERROR');
    if (end.diff(start, 'days').days > MAX_RANGE_DAYS - 1) throw AppError.of(400, 'VALIDATION_ERROR');
    return { start: start.toJSDate(), end: end.plus({ days: 1 }).toJSDate() };
  }
  const local = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(timeZone).startOf('day');
  if (!local.isValid) throw AppError.of(400, 'VALIDATION_ERROR');
  return { start: local.toJSDate(), end: local.plus({ days: 1 }).toJSDate() };
}

export async function listEnergyLogs(
  userId: string,
  timeZone: string,
  query: EnergyLogQuery,
  now = new Date(),
): Promise<EnergyLogList> {
  const range = rangeOf(query, timeZone, now);
  const filters = [
    eq(energyLogs.userId, userId),
    gte(energyLogs.loggedAt, range.start),
    lt(energyLogs.loggedAt, range.end),
  ];
  if (query.since) {
    const since = new Date(query.since);
    if (!Number.isFinite(since.getTime())) throw AppError.of(400, 'VALIDATION_ERROR');
    filters.push(gt(energyLogs.createdAt, since));
  }
  const rows = await getDb()
    .select()
    .from(energyLogs)
    .where(and(...filters))
    .orderBy(asc(energyLogs.loggedAt), asc(energyLogs.id));
  return { items: rows.map(toDto) };
}

/**
 * Morning looks at yesterday and today, so a log this afternoon lowers tomorrow's brief.
 * Evening looks at today only.
 */
export async function hasLowEnergy(
  userId: string,
  timeZone: string,
  now: Date,
  scope: 'morning' | 'evening',
): Promise<boolean> {
  const local = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(timeZone);
  if (!local.isValid) return false;
  const end = local.plus({ days: 1 }).startOf('day');
  const start = scope === 'morning' ? local.minus({ days: 1 }).startOf('day') : local.startOf('day');
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(energyLogs)
    .where(
      and(
        eq(energyLogs.userId, userId),
        gte(energyLogs.loggedAt, start.toJSDate()),
        lt(energyLogs.loggedAt, end.toJSDate()),
        lte(energyLogs.energy, ENERGY_LOW_MAX),
      ),
    );
  return (row?.n ?? 0) > 0;
}

export async function hasLowEnergySafe(
  userId: string,
  timeZone: string,
  now: Date,
  scope: 'morning' | 'evening',
): Promise<boolean> {
  try {
    return await hasLowEnergy(userId, timeZone, now, scope);
  } catch (err) {
    logger.info('energy tone skipped', {
      userId,
      scope,
      reason: err instanceof Error ? err.name : 'error',
    });
    return false;
  }
}

/**
 * One row per local day in [periodStart, periodEnd) that has a log and a next-day rate.
 * Next-day completions may fall on periodEnd itself.
 */
export async function loadEnergyDayLinks(
  userId: string,
  timeZone: string,
  periodStart: string,
  periodEnd: string,
): Promise<EnergyDayLink[]> {
  const start = dayStart(periodStart, timeZone);
  const end = dayStart(periodEnd, timeZone);
  if (!start.isValid || !end.isValid || end <= start) return [];
  const nextEnd = end.plus({ days: 1 });
  const db = getDb();
  const [logs, completions, openDue] = await Promise.all([
    db
      .select({ energy: energyLogs.energy, loggedAt: energyLogs.loggedAt })
      .from(energyLogs)
      .where(
        and(
          eq(energyLogs.userId, userId),
          gte(energyLogs.loggedAt, start.toJSDate()),
          lt(energyLogs.loggedAt, end.toJSDate()),
        ),
      ),
    db
      .select({ completedAt: taskCompletions.completedAt })
      .from(taskCompletions)
      .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.habitId),
          gte(taskCompletions.completedAt, start.toJSDate()),
          lt(taskCompletions.completedAt, nextEnd.toJSDate()),
        ),
      ),
    db
      .select({ dueAt: tasks.dueAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          isNull(tasks.habitId),
          inArray(tasks.status, ['todo', 'doing']),
          isNotNull(tasks.dueAt),
          gte(tasks.dueAt, start.toJSDate()),
          lt(tasks.dueAt, nextEnd.toJSDate()),
        ),
      ),
  ]);

  const energyByDay = new Map<string, number>();
  for (const log of logs) {
    const day = localYmd(log.loggedAt, timeZone);
    if (!day) continue;
    const prev = energyByDay.get(day);
    energyByDay.set(day, prev === undefined ? log.energy : Math.min(prev, log.energy));
  }
  const completedByDay = new Map<string, number>();
  for (const row of completions) {
    const day = localYmd(row.completedAt, timeZone);
    if (!day) continue;
    completedByDay.set(day, (completedByDay.get(day) ?? 0) + 1);
  }
  const openByDay = new Map<string, number>();
  for (const row of openDue) {
    if (!row.dueAt) continue;
    const day = localYmd(row.dueAt, timeZone);
    if (!day) continue;
    openByDay.set(day, (openByDay.get(day) ?? 0) + 1);
  }

  const links: EnergyDayLink[] = [];
  let cursor = start;
  while (cursor < end) {
    const day = cursor.toISODate();
    const next = cursor.plus({ days: 1 }).toISODate();
    cursor = cursor.plus({ days: 1 });
    if (!day || !next) continue;
    const energy = energyByDay.get(day);
    if (energy === undefined) continue;
    links.push({
      day,
      energy,
      nextCompleted: completedByDay.get(next) ?? 0,
      nextDueOpen: openByDay.get(next) ?? 0,
    });
  }
  return links;
}
