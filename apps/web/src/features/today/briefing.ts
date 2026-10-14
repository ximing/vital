import { useEffect, useState } from 'react';
import {
  calendarEventOverlapsLocalDay,
  calendarSyncPayloadReady,
  clothingSuggestion,
  deviceCalendarWindow,
  DEVICE_CALENDAR_SYNC_POLL_MS,
  localTodayYmd,
  nearestStatutoryHoliday,
  normalizeCalendarEvent,
  openMeteoForecastUrl,
  openMeteoGeocodeUrl,
  buildTodayPlan,
  parseOpenMeteoForecast,
  parseOpenMeteoPlace,
  todayModulesOrFallback,
  upcomingExcludingToday,
  weatherConditionKey,
  ymdInTimeZone,
  type TodayLayout,
  type TodayPlan,
  type BriefingTask,
  type ClothingBand,
  type GeoPlace,
  type NormalizedCalendarEvent,
  type WeatherConditionKey,
  type WeatherSample,
} from '@vital/dto';
import { client } from '@/api/client';
import { t } from '@/copy';
import { getVitalHost, type TodayCalendarEvent, type TodayCalendarRead } from '@/host';

export const TODAY_PLACE_KEY = 'vital.today.place';

const CLOTHING: Record<ClothingBand, string> = {
  'hot-dry': t.today.briefing.clothing.hotDry,
  cold: t.today.briefing.clothing.cold,
  rain: t.today.briefing.clothing.rain,
  snow: t.today.briefing.clothing.snow,
  mild: t.today.briefing.clothing.mild,
};

const CONDITION: Record<WeatherConditionKey, string> = {
  clear: t.today.briefing.condition.clear,
  cloudy: t.today.briefing.condition.cloudy,
  fog: t.today.briefing.condition.fog,
  rain: t.today.briefing.condition.rain,
  snow: t.today.briefing.condition.snow,
  overcast: t.today.briefing.condition.overcast,
};

export type TodayBriefingModel = {
  lead: TodayPlan;
  weather:
    | { status: 'loading' }
    | { status: 'unavailable' }
    | { status: 'ready'; place: string; condition: string; temperatureC: number; clothing: string };
  placeBusy: boolean;
  submitPlace: (name: string) => void;
  upcoming: { id: string; title: string; when: string }[];
  holidayName: string;
  holidayDate: string;
  meetings:
    | { status: 'mac-only' }
    | { status: 'denied' }
    | { status: 'failed' }
    | { status: 'events'; events: NormalizedCalendarEvent[] };
  modules: ReturnType<typeof todayModulesOrFallback>;
};

export function chineseYmd(ymd: string): string {
  const [year, month, day] = ymd.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

export function monthDay(ymd: string): string {
  const [, month, day] = ymd.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

export function readSavedPlace(storage: Pick<Storage, 'getItem'> | null = localStorageOrNull()): GeoPlace | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TODAY_PLACE_KEY);
    if (!raw) return null;
    return parseOpenMeteoPlace({ results: [JSON.parse(raw)] });
  } catch {
    return null;
  }
}

export function writeSavedPlace(
  place: GeoPlace,
  storage: Pick<Storage, 'setItem'> | null = localStorageOrNull(),
): void {
  storage?.setItem(TODAY_PLACE_KEY, JSON.stringify(place));
}

function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export async function fetchForecast(latitude: number, longitude: number): Promise<WeatherSample | null> {
  const response = await fetch(openMeteoForecastUrl(latitude, longitude));
  if (!response.ok) return null;
  return parseOpenMeteoForecast(await response.json());
}

export async function geocodePlace(name: string): Promise<GeoPlace | null> {
  const response = await fetch(openMeteoGeocodeUrl(name));
  if (!response.ok) return null;
  return parseOpenMeteoPlace(await response.json());
}

// Long enough for the browser permission prompt. A 1s timeout marks the
// forecast unavailable before the user can choose Allow.
const GEO_TIMEOUT_MS = 20_000;

function locateDevice(): Promise<GeoPlace | null> {
  const geo = globalThis.navigator?.geolocation;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (place: GeoPlace | null) => {
      if (settled) return;
      settled = true;
      resolve(place);
    };
    const timer = setTimeout(() => finish(null), GEO_TIMEOUT_MS);
    geo.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        finish({
          name: '当前位置',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 60 * 60 * 1000 },
    );
  });
}

export function useTodayWeather(): {
  status: 'loading' | 'unavailable' | 'ready';
  place: GeoPlace | null;
  sample: WeatherSample | null;
  busy: boolean;
  submitPlace: (name: string) => void;
} {
  const [place, setPlace] = useState<GeoPlace | null>(null);
  const [sample, setSample] = useState<WeatherSample | null>(null);
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'ready'>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = readSavedPlace();
      const located = saved ?? (await locateDevice());
      if (cancelled) return;
      if (!located) {
        setStatus('unavailable');
        return;
      }
      try {
        const next = await fetchForecast(located.latitude, located.longitude);
        if (cancelled) return;
        if (!next) {
          setStatus('unavailable');
          return;
        }
        if (!saved) writeSavedPlace(located);
        setPlace(located);
        setSample(next);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function submitPlace(name: string): void {
    const trimmed = name.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    void (async () => {
      try {
        const found = await geocodePlace(trimmed);
        if (!found) {
          setStatus('unavailable');
          return;
        }
        const next = await fetchForecast(found.latitude, found.longitude);
        if (!next) {
          setStatus('unavailable');
          return;
        }
        writeSavedPlace(found);
        setPlace(found);
        setSample(next);
        setStatus('ready');
      } catch {
        setStatus('unavailable');
      } finally {
        setBusy(false);
      }
    })();
  }

  return { status, place, sample, busy, submitPlace };
}

export async function readTodayMeetings(timeZone: string): Promise<TodayBriefingModel['meetings']> {
  const host = getVitalHost();
  if (!host?.readTodayCalendar) return { status: 'mac-only' };
  let result: TodayCalendarRead;
  try {
    result = await host.readTodayCalendar();
  } catch {
    return { status: 'failed' };
  }
  if (result.status === 'denied') return { status: 'denied' };
  if (result.status === 'unsupported') return { status: 'mac-only' };
  if (result.status !== 'ok') return { status: 'failed' };
  pushMacCalendar(timeZone, result.events, host.calendarKeys === true);
  const events = result.events
    .filter((event) => calendarEventOverlapsLocalDay(event, timeZone))
    .map((event) => normalizeCalendarEvent(event, timeZone))
    .filter((event): event is NormalizedCalendarEvent => event !== null);
  return { status: 'events', events };
}

function pushMacCalendar(timeZone: string, events: TodayCalendarEvent[], keyed: boolean): void {
  if (events.length >= 200) return;
  if (!calendarSyncPayloadReady(events, 'mac', keyed)) return;
  const span = deviceCalendarWindow(timeZone);
  const payload = events.flatMap((event) => {
    if (typeof event.key !== 'string') return [];
    const title = event.title.trim();
    if (title === '') return [];
    return [
      {
        key: event.key,
        title,
        start: event.start,
        end: typeof event.end === 'string' && event.end !== '' ? event.end : null,
        allDay: event.allDay,
      },
    ];
  });
  try {
    void Promise.resolve(
      client.syncDeviceCalendar?.({
        source: 'mac',
        windowStart: span.windowStart,
        windowEnd: span.windowEnd,
        events: payload,
      }),
    ).catch(() => undefined);
  } catch {
    // A partial client, such as a test double, has no calendar sync method.
  }
}

export function canOpenCalendarSettings(): boolean {
  return typeof getVitalHost()?.openCalendarSettings === 'function';
}

const CALENDAR_ACCESS_EVENT = 'vital-calendar-access';

export function openCalendarSettings(): void {
  const pending = getVitalHost()?.openCalendarSettings?.();
  void Promise.resolve(pending).finally(() => {
    window.dispatchEvent(new Event(CALENDAR_ACCESS_EVENT));
  });
}

export function useTodayMeetings(timeZone: string): TodayBriefingModel['meetings'] {
  const [meetings, setMeetings] = useState<TodayBriefingModel['meetings']>({ status: 'mac-only' });
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void readTodayMeetings(timeZone).then((next) => {
        if (!cancelled) setMeetings(next);
      });
    };
    load();
    const timer = window.setInterval(load, DEVICE_CALENDAR_SYNC_POLL_MS);
    window.addEventListener('focus', load);
    window.addEventListener(CALENDAR_ACCESS_EVENT, load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener(CALENDAR_ACCESS_EVENT, load);
    };
  }, [timeZone]);
  return meetings;
}

export function buildTodayBriefing(input: {
  tasks: readonly BriefingTask[];
  upcomingTasks: readonly BriefingTask[];
  timeZone: string;
  now?: Date;
  weather: {
    status: 'loading' | 'unavailable' | 'ready';
    place: GeoPlace | null;
    sample: WeatherSample | null;
    busy: boolean;
    submitPlace: (name: string) => void;
  };
  meetings: TodayBriefingModel['meetings'];
  layout?: TodayLayout | null;
}): TodayBriefingModel {
  const today = localTodayYmd(input.timeZone, input.now ?? new Date());
  const holiday = nearestStatutoryHoliday(today);
  const upcoming = upcomingExcludingToday(input.upcomingTasks, today, input.timeZone).map((task) => {
    const anchor = task.dueAt ?? task.startAt ?? '';
    return { id: task.id, title: task.title, when: monthDay(ymdInTimeZone(anchor, input.timeZone)) };
  });
  const weather = input.weather;
  let weatherView: TodayBriefingModel['weather'];
  if (weather.status === 'ready' && weather.sample && weather.place) {
    const band = clothingSuggestion(weather.sample);
    weatherView = {
      status: 'ready',
      place: weather.place.name,
      condition: CONDITION[weatherConditionKey(weather.sample.weatherCode)],
      temperatureC: Math.round(weather.sample.temperatureC),
      clothing: CLOTHING[band],
    };
  } else if (weather.status === 'loading') {
    weatherView = { status: 'loading' };
  } else {
    weatherView = { status: 'unavailable' };
  }
  return {
    lead: buildTodayPlan(input.tasks, input.timeZone, input.now ?? new Date()),
    weather: weatherView,
    placeBusy: weather.busy,
    submitPlace: weather.submitPlace,
    upcoming,
    holidayName: holiday.name,
    holidayDate: chineseYmd(holiday.date),
    meetings: input.meetings,
    modules: todayModulesOrFallback(input.layout),
  };
}

export function usePublishTodayContext(
  weather: TodayBriefingModel['weather'],
  meetings: TodayBriefingModel['meetings'],
): void {
  const key = JSON.stringify(contextBody(weather, meetings));
  useEffect(() => {
    if (key === 'null') return;
    void client.putTodayLayoutContext(JSON.parse(key) as Parameters<typeof client.putTodayLayoutContext>[0]).catch(
      () => undefined,
    );
  }, [key]);
}

function contextBody(
  weather: TodayBriefingModel['weather'],
  meetings: TodayBriefingModel['meetings'],
): Parameters<typeof client.putTodayLayoutContext>[0] | null {
  if (weather.status === 'loading') return null;
  return {
    weather:
      weather.status === 'ready'
        ? {
            status: 'ready',
            place: weather.place,
            condition: weather.condition,
            temperatureC: weather.temperatureC,
            clothing: weather.clothing,
          }
        : { status: 'unavailable' },
    meetings:
      meetings.status === 'events'
        ? { status: 'events', events: meetings.events.map((event) => ({ title: event.title, start: event.start, allDay: event.allDay })) }
        : { status: meetings.status },
  };
}
