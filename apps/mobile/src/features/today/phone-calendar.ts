import * as Calendar from 'expo-calendar';
import { Linking, Platform } from 'react-native';
import type { DeviceCalendarSource, NormalizedCalendarEvent } from '@vital/dto';
import {
  calendarQueryWindow,
  eventOverlapsDay,
  localDayBounds,
  normalizeCalendarEvent,
  ymdInTimeZone,
} from './briefing-core';

const DISPLAY_CAP = 40;
const SYNC_CAP = 200;

export type PhoneCalendarSyncEvent = {
  key: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
};

export type PhoneCalendarRead =
  | { status: 'skipped' }
  | { status: 'denied' }
  | { status: 'failed' }
  | {
      status: 'events';
      events: NormalizedCalendarEvent[];
      /**
       * Events whose start falls in the sync window.
       * Null when a row has no stable id, so the caller must not delete tasks.
       */
      syncEvents: PhoneCalendarSyncEvent[] | null;
      source: DeviceCalendarSource;
    };

function instantIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function sourceOf(): DeviceCalendarSource {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

function eventKey(event: Calendar.Event, source: DeviceCalendarSource, timeZone: string): string | null {
  const id = event.id;
  if (typeof id !== 'string' || id.trim() === '') return null;
  const recurring = (event as { recurrenceRule?: unknown }).recurrenceRule != null;
  let suffix = '';
  if (recurring) {
    const start = new Date(instantIso(event.startDate));
    if (Number.isNaN(start.getTime())) return null;
    suffix = `:${ymdInTimeZone(start, timeZone)}`;
  }
  const head = `${source}:`;
  const budget = 200 - head.length - suffix.length;
  if (budget < 1) return null;
  const stable = id.length > budget ? id.slice(0, budget) : id;
  return `${head}${stable}${suffix}`;
}

function eventPayload(event: Calendar.Event, timeZone: string): { title: string; start: string; allDay: boolean } {
  const startIso = instantIso(event.startDate);
  if (!event.allDay) return { title: event.title, start: startIso, allDay: false };
  const parsed = new Date(startIso);
  const start = Number.isNaN(parsed.getTime()) ? '' : ymdInTimeZone(parsed, timeZone);
  return { title: event.title, start, allDay: true };
}

/** Read device events. `ask` shows the system dialog only when the user has not chosen yet. */
export async function readPhoneCalendar(timeZone: string, ask: boolean): Promise<PhoneCalendarRead> {
  try {
    if (!(await Calendar.isAvailableAsync())) return { status: 'failed' };
    let permission = await Calendar.getCalendarPermissionsAsync();
    if (permission.status === 'undetermined') {
      if (!ask) return { status: 'skipped' };
      permission = await Calendar.requestCalendarPermissionsAsync();
    }
    if (permission.status !== 'granted') return { status: 'denied' };
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const ids = calendars.map((calendar) => calendar.id).filter((id) => id !== '');
    const source = sourceOf();
    if (ids.length === 0) return { status: 'events', events: [], syncEvents: [], source };
    const day = localDayBounds(timeZone);
    const query = calendarQueryWindow(day);
    const rows = await Calendar.getEventsAsync(ids, query.start, query.end);
    const sorted = [...rows].sort(
      (a, b) => new Date(instantIso(a.startDate)).getTime() - new Date(instantIso(b.startDate)).getTime(),
    );
    const events = sorted
      .filter((event) => eventOverlapsDay(instantIso(event.startDate), instantIso(event.endDate), day.start, day.end))
      .flatMap((event) => {
        const normalized = normalizeCalendarEvent(eventPayload(event, timeZone), timeZone);
        return normalized ? [normalized] : [];
      })
      .slice(0, DISPLAY_CAP);
    const inWindow = sorted.filter((event) => {
      const start = new Date(instantIso(event.startDate)).getTime();
      return (
        event.title.trim() !== '' &&
        start >= day.start.getTime() &&
        start < query.end.getTime()
      );
    });
    if (inWindow.length >= SYNC_CAP) {
      return { status: 'events', events, syncEvents: null, source };
    }
    const syncEvents: PhoneCalendarSyncEvent[] = [];
    for (const event of inWindow) {
      const key = eventKey(event, source, timeZone);
      const start = new Date(instantIso(event.startDate));
      if (!key || Number.isNaN(start.getTime())) {
        return { status: 'events', events, syncEvents: null, source };
      }
      const end = new Date(instantIso(event.endDate));
      syncEvents.push({
        key,
        title: event.title.trim(),
        start: start.toISOString(),
        end: Number.isNaN(end.getTime()) ? null : end.toISOString(),
        allDay: event.allDay === true,
      });
    }
    return { status: 'events', events, syncEvents, source };
  } catch {
    return { status: 'failed' };
  }
}

/** Ask once when the system has never asked, then open the app's system settings page. */
export async function openPhoneCalendarAccess(): Promise<void> {
  try {
    const current = await Calendar.getCalendarPermissionsAsync();
    if (current.status === 'undetermined') {
      const next = await Calendar.requestCalendarPermissionsAsync();
      if (next.status === 'granted') return;
    }
  } catch {
    // Fall through to the settings page.
  }
  await Linking.openSettings().catch(() => undefined);
}
