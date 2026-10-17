import { z } from 'zod';
import { addDaysYmd, localTodayYmd } from './today-briefing.js';

/** How many local midnights ahead a device calendar read covers, including today. */
export const DEVICE_CALENDAR_SYNC_DAYS = 8;

/** How often an open Today page re-reads the device calendar. */
export const DEVICE_CALENDAR_SYNC_POLL_MS = 30_000;

export const DEVICE_CALENDAR_SOURCES = ['mac', 'ios', 'android'] as const;
export type DeviceCalendarSource = (typeof DEVICE_CALENDAR_SOURCES)[number];

const isoInstant = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'instant');

export const deviceCalendarEventSchema = z.object({
  key: z.string().min(3).max(200),
  title: z.string().min(1).max(500),
  start: isoInstant,
  end: isoInstant.nullable().optional(),
  allDay: z.boolean(),
});
export type DeviceCalendarEvent = z.infer<typeof deviceCalendarEventSchema>;

export const deviceCalendarSyncSchema = z
  .object({
    source: z.enum(DEVICE_CALENDAR_SOURCES),
    windowStart: isoInstant,
    windowEnd: isoInstant,
    events: z.array(deviceCalendarEventSchema).max(200),
  })
  .superRefine((value, ctx) => {
    const start = new Date(value.windowStart).getTime();
    const end = new Date(value.windowEnd).getTime();
    if (!(end > start) || end - start > 14 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({ code: 'custom', message: 'window', path: ['windowEnd'] });
    }
    const prefix = `${value.source}:`;
    for (const [index, event] of value.events.entries()) {
      if (!event.key.startsWith(prefix)) {
        ctx.addIssue({ code: 'custom', message: 'key', path: ['events', index, 'key'] });
      }
    }
  });
export type DeviceCalendarSyncInput = z.infer<typeof deviceCalendarSyncSchema>;

export type DeviceCalendarSyncResult = {
  created: number;
  updated: number;
  removed: number;
};

export type CalendarSyncTask = {
  id: string;
  calendarKey: string;
  title: string;
  startAt: string | null;
  dueAt: string | null;
  /** End of the block when the device sent one. Absent on older snapshots. */
  calendarEndAt?: string | null;
  isAllDay: boolean;
  status: string;
  deletedAt: string | null;
};

export type CalendarSyncPlan = {
  create: DeviceCalendarEvent[];
  update: { id: string; event: DeviceCalendarEvent }[];
  /** Open tasks whose event left the window. The caller clears the key. */
  remove: string[];
};

function zonedMidnight(ymd: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return new Date(NaN);
  const utcGuess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const offsetAt = (utcMs: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(utcMs));
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '0';
    let hour = pick('hour');
    if (hour === '24') hour = '0';
    const asUtc = Date.UTC(
      Number(pick('year')),
      Number(pick('month')) - 1,
      Number(pick('day')),
      Number(hour),
      Number(pick('minute')),
      Number(pick('second')),
    );
    return asUtc - utcMs;
  };
  const offset = offsetAt(utcGuess);
  let instant = utcGuess - offset;
  const corrected = offsetAt(instant);
  if (corrected !== offset) instant = utcGuess - corrected;
  return new Date(instant);
}

/** Local today through the same span the device calendar query uses. */
export function deviceCalendarWindow(timeZone: string, now = new Date()): { windowStart: string; windowEnd: string } {
  const startYmd = localTodayYmd(timeZone, now);
  const start = zonedMidnight(startYmd, timeZone);
  const end = zonedMidnight(addDaysYmd(startYmd, DEVICE_CALENDAR_SYNC_DAYS), timeZone);
  return { windowStart: start.toISOString(), windowEnd: end.toISOString() };
}

/**
 * An empty read may delete tasks, so it only counts when the host build
 * actually sends keys. A missing key means the snapshot is incomplete.
 */
export function calendarSyncPayloadReady(
  events: readonly { key?: unknown }[],
  source: DeviceCalendarSource,
  keyedHost: boolean,
): boolean {
  if (events.length === 0) return keyedHost;
  const prefix = `${source}:`;
  return events.every(
    (event) =>
      typeof event.key === 'string' &&
      event.key.startsWith(prefix) &&
      event.key.length >= prefix.length + 1 &&
      event.key.length <= 200,
  );
}

/** True when the event should appear on the local calendar day that contains `now`. */
export function calendarEventOverlapsLocalDay(
  event: { start: string; end?: string | null },
  timeZone: string,
  now = new Date(),
): boolean {
  const today = localTodayYmd(timeZone, now);
  const dayStart = zonedMidnight(today, timeZone).getTime();
  const dayEnd = zonedMidnight(addDaysYmd(today, 1), timeZone).getTime();
  const start = new Date(event.start).getTime();
  if (Number.isNaN(start) || Number.isNaN(dayStart) || Number.isNaN(dayEnd)) return false;
  const endRaw = event.end ? new Date(event.end).getTime() : start;
  const end = Number.isNaN(endRaw) ? start : endRaw;
  if (end <= start) return start >= dayStart && start < dayEnd;
  return start < dayEnd && end > dayStart;
}

function inWindow(iso: string, windowStart: number, windowEnd: number): boolean {
  const time = new Date(iso).getTime();
  return time >= windowStart && time < windowEnd;
}

function sameInstant(stored: string | null, iso: string): boolean {
  if (stored === null) return false;
  return new Date(stored).getTime() === new Date(iso).getTime();
}

/** Device end, when it is strictly after the start. Point events stay null. */
function normalizedEnd(event: DeviceCalendarEvent): string | null {
  if (!event.end) return null;
  const startMs = new Date(event.start).getTime();
  const endMs = new Date(event.end).getTime();
  if (!Number.isFinite(endMs) || endMs <= startMs) return null;
  return new Date(endMs).toISOString();
}

/**
 * Calendar is the source for linked tasks.
 * A task the user deleted keeps its key and is not recreated.
 * A missing event soft-deletes the open task and clears the key, so the event can return.
 * Another device's task with the same title and start is left alone.
 */
export function planDeviceCalendarSync(
  input: DeviceCalendarSyncInput,
  tasks: readonly CalendarSyncTask[],
): CalendarSyncPlan {
  const windowStart = new Date(input.windowStart).getTime();
  const windowEnd = new Date(input.windowEnd).getTime();
  const prefix = `${input.source}:`;
  const seen = new Set<string>();
  const events: DeviceCalendarEvent[] = [];
  for (const event of input.events) {
    if (!event.key.startsWith(prefix) || seen.has(event.key)) continue;
    if (!inWindow(event.start, windowStart, windowEnd)) continue;
    seen.add(event.key);
    events.push(event);
  }

  const create: DeviceCalendarEvent[] = [];
  const update: { id: string; event: DeviceCalendarEvent }[] = [];
  const claimed = new Set<string>();

  for (const event of events) {
    const rows = tasks.filter((task) => task.calendarKey === event.key);
    const live = rows.find((task) => task.deletedAt === null);
    if (live) {
      claimed.add(live.id);
      const title = event.title.trim();
      const nextEnd = normalizedEnd(event);
      const storedEnd = live.calendarEndAt ?? null;
      const endMoved =
        (storedEnd === null) !== (nextEnd === null) ||
        (storedEnd !== null && nextEnd !== null && !sameInstant(storedEnd, nextEnd));
      const moved =
        live.title !== title ||
        live.isAllDay !== event.allDay ||
        !sameInstant(live.startAt, event.start) ||
        !sameInstant(live.dueAt, event.start) ||
        endMoved;
      if (moved) update.push({ id: live.id, event: { ...event, title } });
      continue;
    }
    if (rows.some((task) => task.deletedAt !== null)) continue;
    const title = event.title.trim();
    const twin = tasks.find(
      (task) =>
        task.deletedAt === null &&
        !claimed.has(task.id) &&
        task.isAllDay === event.allDay &&
        task.title.trim() === title &&
        sameInstant(task.startAt, event.start),
    );
    if (twin) {
      claimed.add(twin.id);
      continue;
    }
    create.push({ ...event, title });
  }

  const remove: string[] = [];
  for (const task of tasks) {
    if (task.deletedAt !== null) continue;
    if (!task.calendarKey.startsWith(prefix)) continue;
    if (task.status === 'done' || task.status === 'canceled') continue;
    if (task.startAt === null || !inWindow(task.startAt, windowStart, windowEnd)) continue;
    if (seen.has(task.calendarKey)) continue;
    remove.push(task.id);
  }

  return { create, update, remove };
}
