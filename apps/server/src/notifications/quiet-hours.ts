import { DateTime } from 'luxon';

export function parseHHmm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':');
  return { hour: Number(h), minute: Number(m) };
}

function minutesOf(hhmm: string): number {
  const { hour, minute } = parseHHmm(hhmm);
  return hour * 60 + minute;
}

/** Inclusive start, exclusive end. Overnight windows wrap midnight. */
export function isInQuietHours(
  instant: Date,
  start: string | null,
  end: string | null,
  timeZone: string,
): boolean {
  if (start === null || end === null || start === end) return false;
  const local = DateTime.fromJSDate(instant, { zone: timeZone });
  const t = local.hour * 60 + local.minute;
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s < e) return t >= s && t < e;
  return t >= s || t < e;
}

/** If `instant` is inside quiet hours, return the next quietHoursEnd in `timeZone`. */
export function applyQuietHours(
  instant: Date,
  start: string | null,
  end: string | null,
  timeZone: string,
): Date {
  if (!isInQuietHours(instant, start, end, timeZone) || end === null || start === null) {
    return instant;
  }
  const { hour, minute } = parseHHmm(end);
  const local = DateTime.fromJSDate(instant, { zone: timeZone });
  const s = minutesOf(start);
  const e = minutesOf(end);
  let target = local.set({ hour, minute, second: 0, millisecond: 0 });
  if (s < e) {
    if (target <= local) target = target.plus({ days: 1 });
  } else if (local.hour * 60 + local.minute >= s) {
    target = target.plus({ days: 1 });
  }
  return target.toJSDate();
}
