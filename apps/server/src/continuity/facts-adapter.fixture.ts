import type { ActivityFact, FactsAdapter, FactsProposal, FactsSearchQuery } from './facts-adapter.js';

const SOURCE = 'https://fixture.vital.test/activities';
const WEATHER_SOURCE = 'https://fixture.vital.test/weather';
const FORECAST_DAYS = 7;

const LEAVE_FREE = '至少留出半天自由时间，不要把这段假期排满。';

type Direction = FactsProposal['direction'];

interface CatalogEntry {
  activityKey: string;
  direction: Direction;
  needsPlace: boolean;
  outdoor: boolean;
  title: string;
  reason: string;
  experience: string;
  timeCost: string;
  moneyRange: string;
  companions: string;
  cancelPolicy: string;
  alternative: string;
  hours: { open: string; close: string } | null;
  price: string;
  reservationRequired: boolean;
}

const CATALOG: readonly CatalogEntry[] = [
  {
    activityKey: 'neighborhood_stroll',
    direction: 'familiar',
    needsPlace: false,
    outdoor: true,
    title: '熟悉街区慢走',
    reason: '从日常散步延伸一点，换一条平时少走的路。',
    experience: '在住处附近慢慢走一圈，看看店招和树，不赶路。',
    timeCost: '约 1.5 小时，步行',
    moneyRange: '免费',
    companions: '独自或家人都行',
    cancelPolicy: '随时取消，没有预约。',
    alternative: '下雨就改成室内看书或在家电影。',
    hours: null,
    price: '免费',
    reservationRequired: false,
  },
  {
    activityKey: 'local_library_browse',
    direction: 'new',
    needsPlace: false,
    outdoor: false,
    title: '去图书馆随便翻',
    reason: '比平时多一点陌生：换一个安静公共空间。',
    experience: '在附近图书馆或书店坐一会儿，不设阅读目标。',
    timeCost: '约 2 小时，公共交通或步行',
    moneyRange: '免费–少量餐饮',
    companions: '适合独自或安静同行',
    cancelPolicy: '无需预约，随时离开。',
    alternative: '闭馆则改成在家整理书架或听书。',
    hours: { open: '09:00', close: '17:00' },
    price: '免费',
    reservationRequired: false,
  },
  {
    activityKey: 'home_film_afternoon',
    direction: 'low_energy',
    needsPlace: false,
    outdoor: false,
    title: '在家下午电影',
    reason: '低精力选项，和家人一起也不用出门。',
    experience: '选一部大家都还能看下去的片子，留出中间休息。',
    timeCost: '约 2.5 小时，不出门',
    moneyRange: '已有订阅或免费',
    companions: '家人或独自',
    cancelPolicy: '随时停下。',
    alternative: '没精神就改成短片或午睡。',
    hours: null,
    price: '已有订阅或免费',
    reservationRequired: false,
  },
  {
    activityKey: 'old_street_walk',
    direction: 'familiar',
    needsPlace: true,
    outdoor: true,
    title: '老街漫步',
    reason: '熟悉兴趣的延伸：还是走路，换一段有故事的街。',
    experience: '在老街区慢走、看店面，不赶景点打卡。',
    timeCost: '约 2 小时，步行与短途交通',
    moneyRange: '待核实，预计餐饮 50–150 元',
    companions: '独自或一位同行',
    cancelPolicy: '无需门票；餐饮可现场决定。',
    alternative: '户外不适则改成室内博物馆或咖啡馆。',
    hours: { open: '10:00', close: '21:00' },
    price: '街区免费，餐饮另计',
    reservationRequired: false,
  },
  {
    activityKey: 'city_museum_night',
    direction: 'new',
    needsPlace: true,
    outdoor: false,
    title: '夜间博物馆',
    reason: '适度陌生：换一个平时少去的展陈时段。',
    experience: '看一场夜场或延长开放，控制在一个展厅。',
    timeCost: '约 2.5 小时，含往返交通',
    moneyRange: '待核实，预计 0–80 元',
    companions: '独自或一位同行',
    cancelPolicy: '免费场次无需预约；收费场次以主办方为准。',
    alternative: '闭馆或预约满则改成书店或室内展览。',
    hours: { open: '18:00', close: '21:00' },
    price: '0–80 元',
    reservationRequired: true,
  },
  {
    activityKey: 'community_park_picnic',
    direction: 'low_energy',
    needsPlace: true,
    outdoor: true,
    title: '社区公园野餐',
    reason: '低精力、可与家人一起，不排满整天。',
    experience: '带简单食物在附近公园坐一会儿，不安排行程。',
    timeCost: '约 2 小时，步行',
    moneyRange: '食材 30–80 元',
    companions: '家人或低精力同伴',
    cancelPolicy: '无需预约，天气不好直接取消。',
    alternative: '下雨或大风改成在家下午电影。',
    hours: { open: '08:00', close: '19:00' },
    price: '公园免费，食材另计',
    reservationRequired: false,
  },
];

const weatherByKey = new Map<string, ActivityFact>();
const timeoutKeys = new Set<string>();
let timeoutAll = false;

function weatherKey(place: string | null, date: string): string {
  return `${place ?? ''}:${date}`;
}

function nowIso(at = new Date()): string {
  return at.toISOString();
}

function validUntilHours(at: Date, hours: number): string {
  return new Date(at.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function daysUntil(dateYmd: string, at: Date): number {
  const target = Date.parse(`${dateYmd}T00:00:00.000Z`);
  if (!Number.isFinite(target)) return Number.POSITIVE_INFINITY;
  return Math.floor((target - at.getTime()) / (24 * 60 * 60 * 1000));
}

function toProposal(entry: CatalogEntry, place: string | null, at: Date): FactsProposal {
  const resolvedPlace = entry.needsPlace ? place : null;
  const facts: ActivityFact[] = [
    {
      field: 'hours',
      value: entry.hours,
      url: SOURCE,
      fetchedAt: nowIso(at),
      validUntil: validUntilHours(at, 24),
      status: entry.hours ? 'verified' : 'unknown',
    },
    {
      field: 'price',
      value: entry.price,
      url: SOURCE,
      fetchedAt: nowIso(at),
      validUntil: validUntilHours(at, 24),
      status: 'verified',
    },
    {
      field: 'reservation',
      value: { required: entry.reservationRequired },
      url: SOURCE,
      fetchedAt: nowIso(at),
      validUntil: validUntilHours(at, 24),
      status: 'verified',
    },
  ];
  return {
    activityKey: entry.activityKey,
    title: entry.title,
    place: resolvedPlace,
    reason: `${entry.reason} ${LEAVE_FREE}`,
    experience: entry.experience,
    timeCost: entry.timeCost,
    moneyRange: entry.moneyRange,
    companions: entry.companions,
    source: SOURCE,
    cancelPolicy: entry.cancelPolicy,
    alternative: entry.alternative,
    direction: entry.direction,
    facts,
  };
}

function pickCatalog(place: string | null): CatalogEntry[] {
  const needPlace = place !== null && place.trim() !== '';
  const pool = CATALOG.filter((row) => row.needsPlace === needPlace);
  const byDirection = new Map<Direction, CatalogEntry>();
  for (const row of pool) {
    if (!byDirection.has(row.direction)) byDirection.set(row.direction, row);
  }
  return [...byDirection.values()].slice(0, 3);
}

function assertNotTimeout(activityKey: string): void {
  if (timeoutAll || timeoutKeys.has(activityKey)) {
    throw new Error('facts timeout');
  }
}

export function setFixtureWeatherForTest(
  place: string | null,
  date: string,
  fact: ActivityFact | null,
): void {
  const key = weatherKey(place, date);
  if (fact === null) weatherByKey.delete(key);
  else weatherByKey.set(key, fact);
}

export function setFixtureTimeoutKeysForTest(keys: readonly string[] | null): void {
  timeoutKeys.clear();
  timeoutAll = false;
  if (keys === null) return;
  for (const key of keys) timeoutKeys.add(key);
}

export function setFixtureTimeoutAllForTest(value: boolean): void {
  timeoutAll = value;
}

export function resetFixtureFactsForTest(): void {
  weatherByKey.clear();
  timeoutKeys.clear();
  timeoutAll = false;
}

export const fixtureFactsAdapter: FactsAdapter = {
  search(query: FactsSearchQuery): Promise<FactsProposal[]> {
    if (timeoutAll) return Promise.reject(new Error('facts timeout'));
    const at = new Date();
    const place = query.place?.trim() ? query.place.trim() : null;
    return Promise.resolve(pickCatalog(place).map((entry) => toProposal(entry, place, at)));
  },

  verifyActivity(
    activityKey: string,
    _when: string,
    place: string | null,
  ): Promise<ActivityFact[]> {
    try {
      assertNotTimeout(activityKey);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error('facts timeout'));
    }
    const at = new Date();
    const entry = CATALOG.find((row) => row.activityKey === activityKey);
    if (!entry) {
      const blank = (field: string): ActivityFact => ({
        field,
        value: null,
        url: null,
        fetchedAt: nowIso(at),
        validUntil: null,
        status: 'unknown',
      });
      return Promise.resolve([blank('hours'), blank('price'), blank('reservation')]);
    }
    return Promise.resolve(toProposal(entry, place, at).facts);
  },

  weather(place: string | null, date: string): Promise<ActivityFact> {
    if (timeoutAll) return Promise.reject(new Error('facts timeout'));
    const override = weatherByKey.get(weatherKey(place, date));
    if (override) return Promise.resolve(override);
    const at = new Date();
    if (daysUntil(date, at) > FORECAST_DAYS) {
      return Promise.resolve({
        field: 'weather',
        value: { condition: null, summary: '超出预报范围，待临近确认' },
        url: WEATHER_SOURCE,
        fetchedAt: nowIso(at),
        validUntil: null,
        status: 'unknown',
      });
    }
    return Promise.resolve({
      field: 'weather',
      value: { condition: 'clear', summary: '晴，适宜出行' },
      url: WEATHER_SOURCE,
      fetchedAt: nowIso(at),
      validUntil: validUntilHours(at, 12),
      status: 'verified',
    });
  },
};

export const FIXTURE_LEAVE_FREE_TIME = LEAVE_FREE;
export const FIXTURE_ACTIVITY_KEYS = CATALOG.map((row) => row.activityKey);
