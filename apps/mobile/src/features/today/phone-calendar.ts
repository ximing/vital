import * as Calendar from 'expo-calendar';
import { Linking } from 'react-native';
import type { NormalizedCalendarEvent } from '@vital/dto';
import {
  calendarQueryWindow,
  eventOverlapsDay,
  localDayBounds,
  normalizeCalendarEvent,
  ymdInTimeZone,
} from './briefing-core';

const MAX_EVENTS = 40;

export type PhoneCalendarRead =
  | { status: 'skipped' }
  | { status: 'denied' }
  | { status: 'failed' }
  | { status: 'events'; events: NormalizedCalendarEvent[] };

function instantIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function eventPayload(event: Calendar.Event, timeZone: string): { title: string; start: string; allDay: boolean } {
  const startIso = instantIso(event.startDate);
  if (!event.allDay) return { title: event.title, start: startIso, allDay: false };
  const parsed = new Date(startIso);
  const start = Number.isNaN(parsed.getTime()) ? '' : ymdInTimeZone(parsed, timeZone);
  return { title: event.title, start, allDay: true };
}

/** Read today's device events. `ask` shows the system dialog only when the user has not chosen yet. */
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
    if (ids.length === 0) return { status: 'events', events: [] };
    const day = localDayBounds(timeZone);
    const query = calendarQueryWindow(day);
    const rows = await Calendar.getEventsAsync(ids, query.start, query.end);
    const events = rows
      .filter((event) => eventOverlapsDay(instantIso(event.startDate), instantIso(event.endDate), day.start, day.end))
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .flatMap((event) => {
        const normalized = normalizeCalendarEvent(eventPayload(event, timeZone), timeZone);
        return normalized ? [normalized] : [];
      })
      .slice(0, MAX_EVENTS);
    return { status: 'events', events };
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
