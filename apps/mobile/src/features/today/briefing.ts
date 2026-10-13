import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import {
  localTodayYmd,
  openMeteoForecastUrl,
  openMeteoGeocodeUrl,
  openTodayTitles,
  parseOpenMeteoForecast,
  parseOpenMeteoPlace,
  weatherConditionKey,
  todayModulesOrFallback,
  ymdInTimeZone,
  type BriefingTask,
  type NormalizedCalendarEvent,
  type TodayLayout,
  type ClothingBand,
  type GeoPlace,
  type WeatherConditionKey,
  type WeatherSample,
} from '@vital/dto';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { clothingSuggestion, nearestStatutoryHoliday, upcomingExcludingToday } from './briefing-core';
import { readPhoneCalendar, type PhoneCalendarRead } from './phone-calendar';

export {
  clothingSuggestion,
  nearestStatutoryHoliday,
  normalizeCalendarEvent,
  upcomingExcludingToday,
} from './briefing-core';

const PLACE_KEY = 'vital.today.place';

const CLOTHING: Record<ClothingBand, string> = {
  'hot-dry': copy.today.briefing.clothing.hotDry,
  cold: copy.today.briefing.clothing.cold,
  rain: copy.today.briefing.clothing.rain,
  snow: copy.today.briefing.clothing.snow,
  mild: copy.today.briefing.clothing.mild,
};

const CONDITION: Record<WeatherConditionKey, string> = {
  clear: copy.today.briefing.condition.clear,
  cloudy: copy.today.briefing.condition.cloudy,
  fog: copy.today.briefing.condition.fog,
  rain: copy.today.briefing.condition.rain,
  snow: copy.today.briefing.condition.snow,
  overcast: copy.today.briefing.condition.overcast,
};

export type TodayBriefingModel = {
  lead: string;
  weather:
    | { status: 'loading' }
    | { status: 'unavailable' }
    | { status: 'ready'; place: string; condition: string; temperatureC: number; clothing: string };
  placeBusy: boolean;
  submitPlace: (name: string) => void;
  upcoming: { id: string; title: string; when: string }[];
  holidayName: string;
  holidayDate: string;
  meetings: { status: 'loading' } | PhoneCalendarRead;
  modules: ReturnType<typeof todayModulesOrFallback>;
};

export function todayLead(titles: readonly string[]): string {
  if (titles.length === 0) return copy.today.briefing.empty;
  const first = titles[0] ?? '';
  if (titles.length === 1) return copy.today.briefing.leadOne.replace('{title}', first);
  return copy.today.briefing.leadMany
    .replace('{n}', String(titles.length))
    .replace('{items}', titles.slice(0, 3).join('、'));
}

export function chineseYmd(ymd: string): string {
  const [year, month, day] = ymd.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function monthDay(ymd: string): string {
  const [, month, day] = ymd.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

async function readSavedPlace(): Promise<GeoPlace | null> {
  const raw = await SecureStore.getItemAsync(PLACE_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return parseOpenMeteoPlace({ results: [JSON.parse(raw)] });
  } catch {
    return null;
  }
}

async function writeSavedPlace(place: GeoPlace): Promise<void> {
  await SecureStore.setItemAsync(PLACE_KEY, JSON.stringify(place)).catch(() => undefined);
}

async function fetchForecast(latitude: number, longitude: number): Promise<WeatherSample | null> {
  const response = await fetch(openMeteoForecastUrl(latitude, longitude));
  if (!response.ok) return null;
  return parseOpenMeteoForecast(await response.json());
}

async function geocodePlace(name: string): Promise<GeoPlace | null> {
  const response = await fetch(openMeteoGeocodeUrl(name));
  if (!response.ok) return null;
  return parseOpenMeteoPlace(await response.json());
}

// Long enough for a permission prompt. A 1s timeout treats the forecast as
// unavailable before the user can allow location.
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
      const saved = await readSavedPlace();
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
        if (!saved) await writeSavedPlace(located);
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
        await writeSavedPlace(found);
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

export function useTodayMeetings(timeZone: string, ask: boolean): TodayBriefingModel['meetings'] {
  const [meetings, setMeetings] = useState<TodayBriefingModel['meetings']>({ status: 'loading' });
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let inflight = false;
      let pending = false;
      const load = () => {
        if (inflight) {
          pending = true;
          return;
        }
        inflight = true;
        pending = false;
        void readPhoneCalendar(timeZone, ask).then((next) => {
          inflight = false;
          if (!cancelled) setMeetings(next);
          if (pending && !cancelled) load();
        });
      };
      load();
      const subscription = AppState.addEventListener('change', (next) => {
        if (next === 'active') load();
      });
      return () => {
        cancelled = true;
        subscription.remove();
      };
    }, [ask, timeZone]),
  );
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
    weatherView = {
      status: 'ready',
      place: weather.place.name,
      condition: CONDITION[weatherConditionKey(weather.sample.weatherCode)],
      temperatureC: Math.round(weather.sample.temperatureC),
      clothing: CLOTHING[clothingSuggestion(weather.sample)],
    };
  } else if (weather.status === 'loading') {
    weatherView = { status: 'loading' };
  } else {
    weatherView = { status: 'unavailable' };
  }
  return {
    lead: todayLead(openTodayTitles(input.tasks)),
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
  const key = JSON.stringify(mobileContextBody(weather, meetings));
  useEffect(() => {
    if (key === 'null') return;
    void client
      .putTodayLayoutContext(JSON.parse(key) as Parameters<typeof client.putTodayLayoutContext>[0])
      .catch(() => undefined);
  }, [key]);
}

function mobileContextBody(
  weather: TodayBriefingModel['weather'],
  meetings: TodayBriefingModel['meetings'],
): Parameters<typeof client.putTodayLayoutContext>[0] | null {
  if (weather.status === 'loading' || meetings.status === 'loading') return null;
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
    meetings: publishedMeetings(meetings),
  };
}

function publishedMeetings(
  meetings: Exclude<TodayBriefingModel['meetings'], { status: 'loading' }>,
): Parameters<typeof client.putTodayLayoutContext>[0]['meetings'] {
  if (meetings.status === 'skipped') return null;
  if (meetings.status !== 'events') return { status: meetings.status };
  return {
    status: 'events',
    events: meetings.events.slice(0, 20).map((event: NormalizedCalendarEvent) => ({
      title: event.title.slice(0, 120),
      start: event.start.slice(0, 40),
      allDay: event.allDay,
    })),
  };
}
