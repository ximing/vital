import { DateTime } from 'luxon';
import type { NowRecommendation, OutcomeSignal, TodayNow } from '@vital/dto';
import { isInQuietHours, parseHHmm } from '../notifications/quiet-hours.js';
import { isOverdue } from './rule-engine.js';

/**
 * Rule layer for the "当下" (Now) card. Pure functions over plain inputs — no
 * db/fastify — so behavior is fully covered by table-driven tests. The agent
 * layer may later replace `reason` with a headline; everything else stays
 * deterministic.
 */

export interface NowEngineTask {
  id: string;
  title: string;
  status: string;
  /** 0 (highest) – 3 (lowest). */
  priority: number;
  estimateMinutes: number | null;
  dueAt: Date | null;
  isAllDay: boolean;
  outcomeId: string | null;
  /** Signal of the owning thread; null when the task has no thread. */
  outcomeSignal: OutcomeSignal | null;
}

/** Active habit window in local 'HH:mm'; may wrap midnight. */
export interface NowEngineHabitWindow {
  start: string;
  end: string;
}

export interface NowEngineInput {
  now: Date;
  timezone: string;
  tasks: NowEngineTask[];
  habitWindows: NowEngineHabitWindow[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

/** Below this many minutes the slot reads as too short to start anything. */
export const NOW_MIN_COMFORT_MINUTES = 10;

const MAX_RECOMMENDATIONS = 2;

function minutesOfHhmm(value: string): number {
  const { hour, minute } = parseHHmm(value);
  return hour * 60 + minute;
}

function localDayOf(at: Date, tz: string): string {
  return DateTime.fromJSDate(at).setZone(tz).toISODate() ?? '';
}

/**
 * Minutes of continuous time until the nearest boundary: the end of a habit
 * window that contains now, the next quiet-hours start, or the end of the
 * local day — whichever comes first.
 */
export function continuousMinutes(input: NowEngineInput): number {
  const local = DateTime.fromJSDate(input.now, { zone: input.timezone });
  const dayStart = local.startOf('day');
  const nowMin = local.hour * 60 + local.minute;

  const boundaries: DateTime[] = [dayStart.plus({ days: 1 })];

  const { quietHoursStart, quietHoursEnd } = input;
  if (quietHoursStart !== null && quietHoursEnd !== null && quietHoursStart !== quietHoursEnd) {
    const s = minutesOfHhmm(quietHoursStart);
    if (s > nowMin) boundaries.push(dayStart.plus({ minutes: s }));
  }

  for (const window of input.habitWindows) {
    const s = minutesOfHhmm(window.start);
    const e = minutesOfHhmm(window.end);
    if (s === e) continue;
    if (s < e) {
      if (nowMin >= s && nowMin < e) boundaries.push(dayStart.plus({ minutes: e }));
    } else if (nowMin >= s) {
      // Overnight window, now past the start: ends tomorrow.
      boundaries.push(dayStart.plus({ days: 1, minutes: e }));
    } else if (nowMin < e) {
      // Overnight window, now before the end: ends today.
      boundaries.push(dayStart.plus({ minutes: e }));
    }
  }

  const earliest = boundaries.reduce((min, b) => (b < min ? b : min));
  return Math.max(0, Math.floor(earliest.diff(local, 'minutes').minutes));
}

function quietReason(input: NowEngineInput): string {
  const end = input.quietHoursEnd ?? '';
  const start = input.quietHoursStart ?? end;
  const local = DateTime.fromJSDate(input.now, { zone: input.timezone });
  const nowMin = local.hour * 60 + local.minute;
  // Overnight window entered after its start resumes tomorrow.
  const tomorrow = minutesOfHhmm(start) > minutesOfHhmm(end) && nowMin >= minutesOfHhmm(start);
  return `现在是静默时段，先休息。${tomorrow ? '明天 ' : ''}${end} 后再来看看。`;
}

function dueWeight(task: NowEngineTask, now: Date, tz: string): number {
  if (task.dueAt === null) return 0;
  if (isOverdue(task.dueAt, task.isAllDay, now, tz)) return 4;
  return localDayOf(task.dueAt, tz) === localDayOf(now, tz) ? 2 : 1;
}

/** Deterministic ladder: thread signal ≫ priority ≫ due urgency. */
function scoreTask(task: NowEngineTask, now: Date, tz: string): number {
  const signal =
    task.outcomeSignal === 'alert'
      ? 3
      : task.outcomeSignal === 'up'
        ? 2
        : task.outcomeSignal === 'flat'
          ? 1
          : 0;
  const priority = 3 - Math.min(3, Math.max(0, task.priority));
  return signal * 100 + priority * 10 + dueWeight(task, now, tz);
}

function isDueSoon(task: NowEngineTask, now: Date, tz: string): boolean {
  if (task.dueAt === null) return false;
  return (
    isOverdue(task.dueAt, task.isAllDay, now, tz) ||
    localDayOf(task.dueAt, tz) === localDayOf(now, tz)
  );
}

function toRecommendation(task: NowEngineTask, now: Date, tz: string): NowRecommendation {
  return {
    taskId: task.id,
    title: task.title,
    estimateMinutes: task.estimateMinutes,
    outcomeId: task.outcomeId,
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    dueSoon: isDueSoon(task, now, tz),
  };
}

export function computeNow(input: NowEngineInput): TodayNow {
  const minutes = continuousMinutes(input);

  if (isInQuietHours(input.now, input.quietHoursStart, input.quietHoursEnd, input.timezone)) {
    return { continuousMinutes: minutes, quiet: true, recommendations: [], reason: quietReason(input) };
  }

  const open = input.tasks.filter((t) => t.status === 'todo' || t.status === 'doing');
  if (open.length === 0) {
    return {
      continuousMinutes: minutes,
      quiet: false,
      recommendations: [],
      reason: '今天没有待办，留一点时间给自己。',
    };
  }

  // Per-item filter only: unestimated tasks stay eligible and render as 未估时.
  const ranked = open
    .filter((t) => t.estimateMinutes === null || t.estimateMinutes <= minutes)
    .map((task) => ({ task, score: scoreTask(task, input.now, input.timezone) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.task.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.task.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
        a.task.id.localeCompare(b.task.id),
    );

  const recommendations = ranked
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ task }) => toRecommendation(task, input.now, input.timezone));

  if (recommendations.length === 0) {
    const reason =
      minutes < NOW_MIN_COMFORT_MINUTES
        ? `只剩 ${String(minutes)} 分钟，暂时没有能从容完成的任务。`
        : '暂时没有能在这段时间完成的任务。';
    return { continuousMinutes: minutes, quiet: false, recommendations, reason };
  }

  return {
    continuousMinutes: minutes,
    quiet: false,
    recommendations,
    reason: '任选一件开始，两件都是候选，不必按顺序。',
  };
}
