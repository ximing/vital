import type { CoverPreset, DayCalendar, DayCatalogKind, DayReminderOffset } from '@vital/dto';
import { jieqiYmd, lunarToSolar, nthWeekdayYmd, padYmd } from './lunar.js';

export type CatalogDef = {
  key: string;
  name: string;
  kind: DayCatalogKind;
  calendar: DayCalendar;
  defaultCover: CoverPreset;
  defaultReminders: DayReminderOffset[];
  occurrenceInYear: (year: number) => string;
};

function lunarDay(month: number, day: number): (year: number) => string {
  return (year) => lunarToSolar(year, month, day, false) ?? padYmd(year, month, 1);
}

function solarDay(month: number, day: number): (year: number) => string {
  return (year) => padYmd(year, month, day);
}

export const DAY_CATALOG: readonly CatalogDef[] = [
  {
    key: 'cn.new-year',
    name: '元旦',
    kind: 'statutory',
    calendar: 'solar',
    defaultCover: 'lantern',
    defaultReminders: [0],
    occurrenceInYear: solarDay(1, 1),
  },
  {
    key: 'cn.spring-festival',
    name: '春节',
    kind: 'statutory',
    calendar: 'lunar',
    defaultCover: 'lantern',
    defaultReminders: [0],
    occurrenceInYear: lunarDay(1, 1),
  },
  {
    key: 'cn.qingming',
    name: '清明节',
    kind: 'statutory',
    calendar: 'solar',
    defaultCover: 'willow',
    defaultReminders: [0],
    occurrenceInYear: (year) => jieqiYmd(year, '清明', 4, 3, 6),
  },
  {
    key: 'cn.labor-day',
    name: '劳动节',
    kind: 'statutory',
    calendar: 'solar',
    defaultCover: 'field',
    defaultReminders: [0],
    occurrenceInYear: solarDay(5, 1),
  },
  {
    key: 'cn.dragon-boat',
    name: '端午节',
    kind: 'statutory',
    calendar: 'lunar',
    defaultCover: 'river',
    defaultReminders: [0],
    occurrenceInYear: lunarDay(5, 5),
  },
  {
    key: 'cn.mid-autumn',
    name: '中秋节',
    kind: 'statutory',
    calendar: 'lunar',
    defaultCover: 'moon',
    defaultReminders: [0],
    occurrenceInYear: lunarDay(8, 15),
  },
  {
    key: 'cn.national-day',
    name: '国庆节',
    kind: 'statutory',
    calendar: 'solar',
    defaultCover: 'silk',
    defaultReminders: [0],
    occurrenceInYear: solarDay(10, 1),
  },
  {
    key: 'cn.chuxi',
    name: '除夕',
    kind: 'traditional',
    calendar: 'lunar',
    defaultCover: 'lantern',
    defaultReminders: [],
    occurrenceInYear: (year) => {
      const spring = lunarToSolar(year, 1, 1, false);
      if (!spring) return padYmd(year, 2, 1);
      const { y, m, d } = {
        y: Number(spring.slice(0, 4)),
        m: Number(spring.slice(5, 7)),
        d: Number(spring.slice(8, 10)),
      };
      const dt = new Date(Date.UTC(y, m - 1, d - 1));
      return padYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    },
  },
  {
    key: 'cn.yuanxiao',
    name: '元宵节',
    kind: 'traditional',
    calendar: 'lunar',
    defaultCover: 'lantern',
    defaultReminders: [],
    occurrenceInYear: lunarDay(1, 15),
  },
  {
    key: 'cn.qixi',
    name: '七夕',
    kind: 'traditional',
    calendar: 'lunar',
    defaultCover: 'tea',
    defaultReminders: [],
    occurrenceInYear: lunarDay(7, 7),
  },
  {
    key: 'cn.chongyang',
    name: '重阳节',
    kind: 'traditional',
    calendar: 'lunar',
    defaultCover: 'mist',
    defaultReminders: [],
    occurrenceInYear: lunarDay(9, 9),
  },
  {
    key: 'cn.dongzhi',
    name: '冬至',
    kind: 'traditional',
    calendar: 'solar',
    defaultCover: 'snow',
    defaultReminders: [],
    occurrenceInYear: (year) => jieqiYmd(year, '冬至', 12, 20, 23),
  },
  {
    key: 'cn.laba',
    name: '腊八',
    kind: 'traditional',
    calendar: 'lunar',
    defaultCover: 'snow',
    defaultReminders: [],
    occurrenceInYear: lunarDay(12, 8),
  },
  {
    key: 'intl.valentine',
    name: '情人节',
    kind: 'international',
    calendar: 'solar',
    defaultCover: 'tea',
    defaultReminders: [],
    occurrenceInYear: solarDay(2, 14),
  },
  {
    key: 'intl.christmas',
    name: '圣诞节',
    kind: 'international',
    calendar: 'solar',
    defaultCover: 'snow',
    defaultReminders: [],
    occurrenceInYear: solarDay(12, 25),
  },
  {
    key: 'intl.mothers-day',
    name: '母亲节',
    kind: 'international',
    calendar: 'solar',
    defaultCover: 'blossom',
    defaultReminders: [],
    occurrenceInYear: (year) => nthWeekdayYmd(year, 5, 0, 2),
  },
  {
    key: 'intl.fathers-day',
    name: '父亲节',
    kind: 'international',
    calendar: 'solar',
    defaultCover: 'field',
    defaultReminders: [],
    occurrenceInYear: (year) => nthWeekdayYmd(year, 6, 0, 3),
  },
];

export const STATUTORY_KEYS = DAY_CATALOG.filter((item) => item.kind === 'statutory').map(
  (item) => item.key,
);

const BY_KEY = new Map(DAY_CATALOG.map((item) => [item.key, item]));

export function catalogByKey(key: string): CatalogDef | undefined {
  return BY_KEY.get(key);
}

export function catalogKindOf(key: string | null): DayCatalogKind | null {
  if (key === null) return null;
  return catalogByKey(key)?.kind ?? null;
}
