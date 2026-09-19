import type { Day } from '@vital/dto';

const MIN_SPAN_MONTHS = 3;

export type TimelineMonthTick = {
  year: number;
  month: number;
  ymd: string;
  leftPercent: number;
};

export type TimelinePoint = {
  id: string;
  name: string;
  nextYmd: string;
  leftPercent: number;
  amber: boolean;
};

export type TimelineLabelInput = {
  id: string;
  name: string;
  dateText: string;
  leftPercent: number;
};

export type TimelineLabelPlacement = {
  id: string;
  /** 0 = closest to the axis. `null` = label omitted (dot stays). */
  lane: number | null;
  labelLeftPercent: number;
  widthPercent: number;
};

export type TimelineLabelLayout = {
  lanesUsed: number;
  placements: TimelineLabelPlacement[];
};

export const TIMELINE_MAX_LANES = 3;
export const TIMELINE_LABEL_EM_PX = 11;
export const TIMELINE_LABEL_GAP_PX = 12;
export const DEFAULT_TIMELINE_WIDTH_PX = 960;
/** Vertical pitch of one label row above the axis. */
export const TIMELINE_LANE_STEP_PX = 18;
const TIMELINE_TOP_PAD_PX = 8;
const TIMELINE_AXIS_GAP_PX = 10;
const TIMELINE_BELOW_AXIS_PX = 28;
const ASCII_EM = 0.62;
const SPACE_EM = 0.33;

export type DaysTimelineModel = {
  startYmd: string;
  endYmd: string;
  spanMonths: number;
  months: TimelineMonthTick[];
  points: TimelinePoint[];
};

export type HeroTrackModel = {
  fillPercent: number;
  toPercent: number;
  holiday: { leftPercent: number; widthPercent: number } | null;
};

function ymdParts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

export function ymdDiffDays(from: string, to: string): number {
  const a = ymdParts(from);
  const b = ymdParts(to);
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

export function addDaysYmd(ymd: string, days: number): string {
  const { y, m, d } = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function addMonthsYmd(ymd: string, months: number): string {
  const { y, m, d } = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

function nextMonthStart(ymd: string): string {
  const { y, m } = ymdParts(ymd);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/**
 * Timeline label date: MM-DD while within a year of today (the month ticks
 * below the axis carry the calendar context); full YYYY-MM-DD beyond that.
 */
export function timelineYmd(ymd: string, todayYmd: string): string {
  return ymdDiffDays(todayYmd, ymd) <= 366 ? ymd.slice(5) : ymd;
}

function spanMonthsOf(from: string, to: string): number {
  const a = ymdParts(from);
  const b = ymdParts(to);
  const raw = (b.y - a.y) * 12 + (b.m - a.m);
  return Math.max(1, b.d > a.d ? raw + 1 : raw);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function upcomingDays(days: readonly Day[], todayYmd: string): Day[] {
  return days.filter(
    (day) =>
      (day.headline.kind === 'today' || day.headline.kind === 'countdown') &&
      day.nextYmd !== null &&
      day.nextYmd >= todayYmd,
  );
}

export function buildDaysTimeline(days: readonly Day[], todayYmd: string): DaysTimelineModel {
  const upcoming = upcomingDays(days, todayYmd).slice().sort((a, b) => {
    const byDate = (a.nextYmd ?? '').localeCompare(b.nextYmd ?? '');
    if (byDate !== 0) return byDate;
    return a.name.localeCompare(b.name, 'zh');
  });
  if (upcoming.length === 0) {
    return { startYmd: todayYmd, endYmd: todayYmd, spanMonths: 0, months: [], points: [] };
  }

  const farthest = upcoming.reduce((max, day) => {
    const ymd = day.nextYmd ?? todayYmd;
    return ymd > max ? ymd : max;
  }, todayYmd);
  const minEnd = addMonthsYmd(todayYmd, MIN_SPAN_MONTHS);
  let endYmd = farthest > minEnd ? farthest : minEnd;
  if (endYmd === farthest && farthest > todayYmd) {
    // Small right pad so the last dot and its label are not flush against the edge.
    endYmd = addDaysYmd(endYmd, Math.max(2, Math.round(ymdDiffDays(todayYmd, endYmd) * 0.02)));
  }
  const span = Math.max(ymdDiffDays(todayYmd, endYmd), 1);
  const leftPercentOf = (ymd: string) => clampPercent((ymdDiffDays(todayYmd, ymd) / span) * 100);

  const months: TimelineMonthTick[] = [];
  const start = ymdParts(todayYmd);
  months.push({
    year: start.y,
    month: start.m,
    ymd: todayYmd,
    leftPercent: 0,
  });
  let cursor = nextMonthStart(todayYmd);
  while (cursor <= endYmd) {
    const part = ymdParts(cursor);
    months.push({
      year: part.y,
      month: part.m,
      ymd: cursor,
      leftPercent: leftPercentOf(cursor),
    });
    cursor = nextMonthStart(cursor);
  }

  const points: TimelinePoint[] = upcoming.map((day) => ({
    id: day.id,
    name: day.name,
    nextYmd: day.nextYmd ?? todayYmd,
    leftPercent: leftPercentOf(day.nextYmd ?? todayYmd),
    amber: day.holidayRange !== null || day.source !== 'custom',
  }));

  return {
    startYmd: todayYmd,
    endYmd,
    spanMonths: spanMonthsOf(todayYmd, endYmd),
    months,
    points,
  };
}

export function buildHeroTrack(
  todayYmd: string,
  nextYmd: string,
  holidayRange: { from: string; to: string } | null,
): HeroTrackModel {
  const holidayEnd = holidayRange ? addDaysYmd(holidayRange.to, 1) : nextYmd;
  const spanEnd = holidayEnd > nextYmd ? holidayEnd : nextYmd;
  const span = Math.max(ymdDiffDays(todayYmd, spanEnd), 1);
  const pct = (ymd: string) => clampPercent((ymdDiffDays(todayYmd, ymd) / span) * 100);
  const toPercent = nextYmd <= todayYmd ? 100 : pct(nextYmd);
  if (!holidayRange) return { fillPercent: toPercent, toPercent, holiday: null };
  const from = holidayRange.from < todayYmd ? todayYmd : holidayRange.from;
  const leftPercent = pct(from);
  const widthPercent = Math.max(pct(addDaysYmd(holidayRange.to, 1)) - leftPercent, 0);
  return {
    fillPercent: toPercent,
    toPercent,
    holiday: widthPercent > 0 ? { leftPercent, widthPercent } : null,
  };
}

function isWideChar(ch: string): boolean {
  return (ch.codePointAt(0) ?? 0) > 0xff;
}

function textWidthEm(text: string, asciiEm: number): number {
  let em = 0;
  for (const ch of text) em += isWideChar(ch) ? 1 : asciiEm;
  return em;
}

export function estimateTextWidthPx(text: string, emPx = TIMELINE_LABEL_EM_PX): number {
  return textWidthEm(text, ASCII_EM) * emPx;
}

/** CJK at 1em/char; ASCII (dates, spaces) at a condensed tabular width. */
export function estimateLabelWidthPx(name: string, dateText: string, emPx = TIMELINE_LABEL_EM_PX): number {
  return (textWidthEm(name, ASCII_EM) + SPACE_EM + textWidthEm(dateText, ASCII_EM)) * emPx;
}

function preferredLabelLeftPx(leftPercent: number, widthPx: number, containerWidthPx: number): number {
  const centerPx = (leftPercent / 100) * containerWidthPx;
  let left = centerPx - widthPx / 2;
  if (left < 0) left = 0;
  if (left + widthPx > containerWidthPx) left = Math.max(0, containerWidthPx - widthPx);
  return left;
}

function intervalsOverlap(aLeft: number, aRight: number, bLeft: number, bRight: number, gapPx: number): boolean {
  return !(aRight + gapPx <= bLeft || bRight + gapPx <= aLeft);
}

export function timelineTrackMetrics(lanesUsed: number): { height: number; axisTop: number; labelTop: (lane: number) => number } {
  const lanes = Math.max(1, Math.min(TIMELINE_MAX_LANES, lanesUsed));
  const axisTop = TIMELINE_TOP_PAD_PX + lanes * TIMELINE_LANE_STEP_PX + TIMELINE_AXIS_GAP_PX;
  return {
    height: axisTop + TIMELINE_BELOW_AXIS_PX,
    axisTop,
    labelTop: (lane: number) => axisTop - TIMELINE_AXIS_GAP_PX - (lane + 1) * TIMELINE_LANE_STEP_PX,
  };
}

/**
 * Visible segments of the vertical leader line from a stacked label down to
 * its dot, clipped around any lower-lane label boxes the line passes under.
 * Segments shorter than 2px are dropped.
 */
export function clipVerticalLine(
  yTop: number,
  yBottom: number,
  covers: readonly { top: number; bottom: number }[],
): { top: number; height: number }[] {
  const sorted = [...covers].sort((a, b) => a.top - b.top);
  const segments: { top: number; height: number }[] = [];
  let cursor = yTop;
  for (const cover of sorted) {
    const top = Math.max(cover.top, yTop);
    const bottom = Math.min(cover.bottom, yBottom);
    if (bottom <= yTop || top >= yBottom) continue;
    if (top > cursor + 1) segments.push({ top: cursor, height: top - cursor });
    cursor = Math.max(cursor, bottom);
  }
  if (yBottom > cursor + 1) segments.push({ top: cursor, height: yBottom - cursor });
  return segments;
}

/**
 * Greedy lane assignment above the axis. Closer dates win; max 3 lanes.
 * The today marker is left-aligned at 0% and occupies the start of lane 0.
 */
export function assignTimelineLanes(
  points: readonly TimelineLabelInput[],
  opts: {
    containerWidthPx: number;
    todayLabel: string;
    emPx?: number;
    gapPx?: number;
    maxLanes?: number;
  },
): TimelineLabelLayout {
  const containerWidthPx = opts.containerWidthPx > 0 ? opts.containerWidthPx : DEFAULT_TIMELINE_WIDTH_PX;
  const emPx = opts.emPx ?? TIMELINE_LABEL_EM_PX;
  const gapPx = opts.gapPx ?? TIMELINE_LABEL_GAP_PX;
  const maxLanes = opts.maxLanes ?? TIMELINE_MAX_LANES;
  const occupied: { left: number; right: number }[][] = Array.from({ length: maxLanes }, () => []);

  occupied[0]?.push({ left: 0, right: estimateTextWidthPx(opts.todayLabel, emPx) });

  const order = points
    .map((point, index) => ({ point, index }))
    .sort((a, b) => {
      const byPos = a.point.leftPercent - b.point.leftPercent;
      if (byPos !== 0) return byPos;
      const byName = a.point.name.localeCompare(b.point.name, 'zh');
      if (byName !== 0) return byName;
      return a.index - b.index;
    });

  const byId = new Map<string, TimelineLabelPlacement>();
  for (const { point } of order) {
    const widthPx = estimateLabelWidthPx(point.name, point.dateText, emPx);
    const leftPx = preferredLabelLeftPx(point.leftPercent, widthPx, containerWidthPx);
    const rightPx = Math.min(leftPx + widthPx, containerWidthPx);
    let lane: number | null = null;
    for (let i = 0; i < maxLanes; i++) {
      const row = occupied[i];
      if (!row) continue;
      const hits = row.some((box) => intervalsOverlap(leftPx, rightPx, box.left, box.right, gapPx));
      if (!hits) {
        row.push({ left: leftPx, right: rightPx });
        lane = i;
        break;
      }
    }
    byId.set(point.id, {
      id: point.id,
      lane,
      labelLeftPercent: (leftPx / containerWidthPx) * 100,
      widthPercent: (widthPx / containerWidthPx) * 100,
    });
  }

  const placements = points.map((point) => {
    const placed = byId.get(point.id);
    return (
      placed ?? {
        id: point.id,
        lane: null,
        labelLeftPercent: point.leftPercent,
        widthPercent: 0,
      }
    );
  });
  let lanesUsed = 1;
  for (const item of placements) {
    if (item.lane !== null) lanesUsed = Math.max(lanesUsed, item.lane + 1);
  }
  return { lanesUsed, placements };
}
