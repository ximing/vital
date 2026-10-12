import { DateTime } from 'luxon';

/**
 * Due day named in the sentence, resolved against the user's local today.
 * The leftmost phrase wins. At the same index the longer phrase wins.
 * 每 / 每隔 / 每间隔 mark repetition, not a one-off date.
 * Weeks are Monday-first. 下周这天 is the same weekday next week.
 * 下周 with no weekday is next Monday. A bare weekday is the next one on or after today.
 * A month-day with no year rolls forward when it is already past.
 */

const CN = '[零〇一二三四五六七八九十两]{1,3}';
const NUM = `\\d{1,3}|${CN}`;

const ZH_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const NAMED_DAYS: Record<string, number> = {
  大后天: 3,
  大前天: -3,
  后天: 2,
  前天: -2,
  明天: 1,
  明日: 1,
  明儿个: 1,
  明儿: 1,
  翌日: 1,
  次日: 1,
  今天: 0,
  今日: 0,
  今儿个: 0,
  今儿: 0,
  昨天: -1,
  昨日: -1,
};

const WEEKDAY: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
};

interface Hit {
  index: number;
  length: number;
  resolve: (today: DateTime) => DateTime | null;
}

function cnInt(raw: string, max: number): number | null {
  if (/^\d{1,3}$/.test(raw)) {
    const n = Number(raw);
    return n >= 1 && n <= max ? n : null;
  }
  if (raw === '十') return 10 <= max ? 10 : null;
  const tens = /^([一二三四五六七八九两])?十([一二三四五六七八九])?$/.exec(raw);
  if (tens) {
    const hi = tens[1] === undefined ? 1 : ZH_DIGIT[tens[1]];
    const lo = tens[2] === undefined ? 0 : ZH_DIGIT[tens[2]];
    if (hi === undefined || lo === undefined || hi === 0) return null;
    const n = hi * 10 + lo;
    return n >= 1 && n <= max ? n : null;
  }
  const digit = ZH_DIGIT[raw];
  return digit !== undefined && digit >= 1 && digit <= max ? digit : null;
}

function isRepeat(text: string, index: number): boolean {
  return /每(?:个|间隔|隔)?$/.test(text.slice(Math.max(0, index - 3), index));
}

function weekShift(prefix: string): number {
  if (prefix === '上上') return -2;
  if (prefix === '上') return -1;
  if (prefix === '下下') return 2;
  if (prefix === '下') return 1;
  return 0;
}

function monthShift(prefix: string | undefined): number {
  if (prefix === '下下') return 2;
  if (prefix === '下') return 1;
  return 0;
}

function weekdayOnWeek(today: DateTime, shift: number, weekday: number): DateTime {
  const monday = today.minus({ days: today.weekday - 1 });
  return monday.plus({ weeks: shift, days: weekday - 1 });
}

function onOrAfter(today: DateTime, weekday: number): DateTime {
  const delta = (weekday - today.weekday + 7) % 7;
  return today.plus({ days: delta });
}

function calendarDay(today: DateTime, year: number, month: number, day: number): DateTime | null {
  const dt = DateTime.fromObject({ year, month, day }, { zone: today.zone }).startOf('day');
  return dt.isValid ? dt : null;
}

function monthPart(today: DateTime, shift: number, part: string): DateTime | null {
  const first = today.plus({ months: shift }).startOf('month');
  if (!first.isValid) return null;
  if (part === '初') return first;
  if (part === '中') return first.set({ day: 15 });
  return first.endOf('month').startOf('day');
}

function rollDayOfMonth(today: DateTime, day: number): DateTime | null {
  if (day < 1 || day > 31) return null;
  const same = today.set({ day });
  if (same.isValid && same >= today) return same.startOf('day');
  const next = today.plus({ months: 1 }).set({ day });
  return next.isValid ? next.startOf('day') : null;
}

function push(text: string, hits: Hit[], re: RegExp, build: (match: RegExpMatchArray) => Hit['resolve'] | null): void {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  for (const match of text.matchAll(new RegExp(re.source, flags))) {
    if (isRepeat(text, match.index)) continue;
    const resolve = build(match);
    if (resolve === null) continue;
    hits.push({ index: match.index, length: match[0].length, resolve });
  }
}

function collect(text: string): Hit[] {
  const hits: Hit[] = [];
  const named = new RegExp(Object.keys(NAMED_DAYS).sort((a, b) => b.length - a.length).join('|'), 'g');
  push(text, hits, named, (match) => {
    const days = NAMED_DAYS[match[0]];
    if (days === undefined) return null;
    return (today) => today.plus({ days });
  });

  push(text, hits, /(上上|下下|上|下)\s*个?\s*(?:周|星期|礼拜)\s*(?:这天|今天|同一天|这一天)/g, (match) => {
    const shift = weekShift(match[1] ?? '');
    return (today) => today.plus({ weeks: shift });
  });

  push(
    text,
    hits,
    /(上上|下下|上|下|这|本)\s*个?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/g,
    (match) => {
      const weekday = WEEKDAY[match[2] ?? ''];
      if (weekday === undefined) return null;
      const shift = weekShift(match[1] ?? '');
      return (today) => weekdayOnWeek(today, shift, weekday);
    },
  );

  push(text, hits, /(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/g, (match) => {
    const weekday = WEEKDAY[match[1] ?? ''];
    if (weekday === undefined) return null;
    return (today) => onOrAfter(today, weekday);
  });

  push(text, hits, /(上上|下下|上|下|这|本)\s*个?\s*周末/g, (match) => {
    const shift = weekShift(match[1] ?? '');
    return (today) => weekdayOnWeek(today, shift, 6);
  });

  push(text, hits, /周末/g, () => (today) => onOrAfter(today, 6));

  push(text, hits, /(上上|下下|上|下)\s*个?\s*(?:周|星期|礼拜)(?![一二三四五六日天1-7末这今同])/g, (match) => {
    const shift = weekShift(match[1] ?? '');
    return (today) => weekdayOnWeek(today, shift, 1);
  });

  push(text, hits, new RegExp(`(?:过\\s*)?(${NUM})\\s*天(?:后|以后|之后)`, 'g'), (match) => {
    const n = cnInt(match[1] ?? '', 366);
    if (n === null) return null;
    return (today) => today.plus({ days: n });
  });

  push(text, hits, new RegExp(`过\\s*(${NUM})\\s*天`, 'g'), (match) => {
    const n = cnInt(match[1] ?? '', 366);
    if (n === null) return null;
    return (today) => today.plus({ days: n });
  });

  push(text, hits, new RegExp(`(${NUM})\\s*个?\\s*(?:周|星期|礼拜)(?:后|以后|之后)`, 'g'), (match) => {
    const n = cnInt(match[1] ?? '', 104);
    if (n === null) return null;
    return (today) => today.plus({ weeks: n });
  });

  push(text, hits, /半\s*个?\s*月(?:后|以后|之后)/g, () => (today) => today.plus({ days: 15 }));
  push(text, hits, /半\s*年(?:后|以后|之后)/g, () => (today) => today.plus({ months: 6 }));

  push(text, hits, new RegExp(`(${NUM})\\s*个?\\s*月(?:后|以后|之后)`, 'g'), (match) => {
    const n = cnInt(match[1] ?? '', 36);
    if (n === null) return null;
    return (today) => today.plus({ months: n });
  });

  push(text, hits, new RegExp(`(下下|下|这|本)\\s*个?\\s*月\\s*(${NUM})\\s*[号日]`, 'g'), (match) => {
    const day = cnInt(match[2] ?? '', 31);
    if (day === null) return null;
    const shift = monthShift(match[1]);
    return (today) => calendarDay(today, today.plus({ months: shift }).year, today.plus({ months: shift }).month, day);
  });

  push(text, hits, /(下下|下|这|本)?\s*个?\s*月(初|中|底|末)(?!旬)/g, (match) => {
    const part = match[2] ?? '';
    const shift = monthShift(match[1]);
    return (today) => monthPart(today, shift, part);
  });

  push(text, hits, /(下下|下)\s*个?\s*月(?![\d零〇一二三四五六七八九十两初中底末])/g, (match) => {
    const shift = monthShift(match[1]);
    return (today) => today.plus({ months: shift }).startOf('month');
  });

  push(text, hits, new RegExp(`(?:(\\d{4})\\s*年\\s*)?(${NUM})\\s*月\\s*(${NUM})\\s*[号日]`, 'g'), (match) => {
    const month = cnInt(match[2] ?? '', 12);
    const day = cnInt(match[3] ?? '', 31);
    if (month === null || day === null) return null;
    const yearRaw = match[1];
    return (today) => {
      const year = yearRaw === undefined ? today.year : Number(yearRaw);
      let dt = calendarDay(today, year, month, day);
      if (dt === null) return null;
      if (yearRaw === undefined && dt < today) dt = calendarDay(today, year + 1, month, day);
      return dt;
    };
  });

  push(text, hits, new RegExp(`(?<![\\d月])(${NUM})\\s*[号日]`, 'g'), (match) => {
    const day = cnInt(match[1] ?? '', 31);
    if (day === null) return null;
    return (today) => rollDayOfMonth(today, day);
  });

  return hits;
}

export function spokenDueYmd(text: string, zone: string, now: Date): string | null {
  const today = DateTime.fromJSDate(now).setZone(zone).startOf('day');
  if (!today.isValid) return null;
  const hits = collect(text).sort((a, b) => a.index - b.index || b.length - a.length);
  for (const hit of hits) {
    const resolved = hit.resolve(today);
    if (resolved?.isValid) return resolved.toFormat('yyyy-MM-dd');
  }
  return null;
}
