import { randomUUID } from 'node:crypto';
import {
  buildTodayPlan,
  DEFAULT_NOTIFICATION_PREFS,
  hhmmSchema,
  type TodayPlan,
} from '@vital/dto';
import { and, eq, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getDb } from '../db/index.js';
import {
  notificationOutbox,
  tasks,
  todayLayouts,
  users,
  type NotificationOutboxPayload,
  type NotificationOutboxRow,
  type User,
} from '../db/schema.js';
import { DeferredAgentJobError } from '../agent/job-runtime.js';
import { reserveBackgroundModelCall } from '../agent/model-budget.js';
import { loadLlmStore } from '../llm/store.js';
import { completeText, resolveModelFor } from '../llm/pi.js';
import { logger } from '../utils/logger.js';
import { loadRhythmProfileSafe } from '../agent/rhythm-distill.js';
import { rhythmBriefClause } from '../agent/rhythm-profile.js';
import { hasLowEnergySafe } from '../energy/energy.service.js';
import { ENERGY_LOW_MAX } from './energy-link.js';
import { applyQuietHours, parseHHmm } from './quiet-hours.js';

/** Local clock when the user has not chosen one. */
export const MORNING_BRIEF_HM = DEFAULT_NOTIFICATION_PREFS.morningBriefTime;

/** Opening Today within this window of generation skips that day's push. */
export const TODAY_PAGE_OPEN_MS = 30 * 60 * 1000;

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const GAP_MINUTES = 60;

const SYSTEM_PROMPT = `你写一条中文晨报，给手机通知用，120 字以内。只使用材料里的事实，不编造任务、日程、天气或空档。
材料写了空档时，正文必须包含「空档」，并建议把底稿里点名的那一件挪到空档或明天。
材料没有空档时，不要写「空档」。
没有日程也没有逾期时，只输出底稿那一句，不要另写建议。底稿里若有「精力偏低」，必须原样保留这句和要挪的标题。
不要标题，不要列表。`;

export type MorningMeeting = { title: string; start: string; allDay: boolean };

export type MorningBriefFacts = {
  plan: TodayPlan;
  meetings: MorningMeeting[];
  weather: string | null;
  /** Yesterday or today has an energy log ≤ ENERGY_LOW_MAX. */
  lowEnergy?: boolean;
};

export type MeetingGap = { after: string; before: string; minutes: number };

type MorningBriefComplete = (user: User, prompt: string) => Promise<string | null>;

/** Test seam. Production leaves this null and calls the model. */
let completeOverride: MorningBriefComplete | null = null;

export function setMorningBriefComplete(next: MorningBriefComplete | null): void {
  completeOverride = next;
}

function briefHm(value: string): string {
  const parsed = hhmmSchema.safeParse(value);
  return parsed.success ? parsed.data : MORNING_BRIEF_HM;
}

function claimed(id: string) {
  return and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, 'sending'));
}

function openCount(plan: TodayPlan): number {
  const counts = plan.counts;
  return counts.overdue + counts.urgent + counts.high + counts.medium + counts.plain;
}

function gapLengthLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${String(minutes / 60)} 小时`;
  return `${String(minutes)} 分钟`;
}

function timedMeetings(meetings: readonly MorningMeeting[]): MorningMeeting[] {
  return meetings.filter((item) => !item.allDay && HM.test(item.start));
}

/** Gaps are minutes between consecutive timed starts. All-day events are not gaps. */
export function meetingGaps(meetings: readonly MorningMeeting[]): MeetingGap[] {
  const timed = timedMeetings(meetings).slice().sort((a, b) => {
    const byStart = a.start.localeCompare(b.start);
    if (byStart !== 0) return byStart;
    return a.title.localeCompare(b.title, 'zh');
  });
  const gaps: MeetingGap[] = [];
  for (let i = 1; i < timed.length; i += 1) {
    const prev = timed[i - 1];
    const next = timed[i];
    if (!prev || !next) continue;
    const minutes = parseHHmm(next.start).hour * 60 + parseHHmm(next.start).minute
      - (parseHHmm(prev.start).hour * 60 + parseHHmm(prev.start).minute);
    if (minutes >= GAP_MINUTES) gaps.push({ after: prev.title, before: next.title, minutes });
  }
  return gaps;
}

function tightest(gaps: readonly MeetingGap[]): MeetingGap | null {
  let best: MeetingGap | null = null;
  for (const gap of gaps) {
    if (!best || gap.minutes < best.minutes) best = gap;
  }
  return best;
}

/** No schedule facts and nothing overdue: one sentence, no advice — unless energy is low. */
export function morningBriefIsShort(facts: MorningBriefFacts): boolean {
  return facts.meetings.length === 0 && facts.plan.counts.overdue === 0;
}

function lowEnergyClause(facts: MorningBriefFacts): string | null {
  if (!facts.lowEnergy) return null;
  const move = facts.plan.items[0]?.title;
  const mark = `今天精力偏低（≤${String(ENERGY_LOW_MAX)}）`;
  if (move) return `${mark}，「${move}」可以挪到明天`;
  return `${mark}，可以少排一点`;
}

export function morningBriefTemplate(facts: MorningBriefFacts, rhythmClause: string | null = null): string {
  const open = openCount(facts.plan);
  const overdue = facts.plan.counts.overdue;
  if (morningBriefIsShort(facts)) {
    const base = `今天 ${String(open)} 件，没有逾期`;
    const extra = lowEnergyClause(facts);
    return extra ? `${base}。${extra}` : base;
  }
  const parts: string[] = [];
  if (overdue === 0) {
    parts.push(`今天 ${String(open)} 件，没有逾期`);
  } else {
    const names = facts.plan.items
      .filter((item) => item.mark === 'overdue')
      .map((item) => item.title)
      .slice(0, 3);
    parts.push(
      names.length > 0
        ? `今天 ${String(open)} 件，逾期 ${String(overdue)} 件：${names.join('、')}`
        : `今天 ${String(open)} 件，逾期 ${String(overdue)} 件`,
    );
  }
  const focus = facts.plan.items
    .filter((item) => item.mark !== 'overdue')
    .map((item) => item.title)
    .slice(0, 3);
  if (focus.length > 0) parts.push(`优先：${focus.join('、')}`);
  if (facts.meetings.length > 0) {
    const shown = facts.meetings
      .slice(0, 4)
      .map((item) => (item.allDay ? `${item.title}（全天）` : `${item.title} ${item.start}`));
    parts.push(`日程：${shown.join('、')}`);
  }
  const gap = tightest(meetingGaps(facts.meetings));
  if (gap) {
    const move = facts.plan.items.find((item) => item.mark === 'overdue')?.title ?? facts.plan.items[0]?.title;
    const advice = move ? `建议把「${move}」挪到这段或明天` : '建议把一件要事放进这段或明天';
    const count = timedMeetings(facts.meetings).length;
    const head = count >= 2 ? `${String(count)} 个日程之间有空档，` : '';
    parts.push(`${head}${gap.after}和${gap.before}之间有 ${gapLengthLabel(gap.minutes)}空档，${advice}`);
    if (rhythmClause) parts.push(rhythmClause);
  }
  if (facts.weather) parts.push(`天气 ${facts.weather}`);
  const extra = lowEnergyClause(facts);
  if (extra) parts.push(extra);
  return parts.join('。');
}

function withRhythmClause(body: string, gapCount: number, clause: string | null): string {
  if (!clause || gapCount <= 0 || body.includes(clause)) return body;
  const extra = `。${clause}`;
  const room = 200 - extra.length;
  const head = room > 0 && body.length > room ? body.slice(0, room).trim() : body;
  return `${head}${extra}`;
}

/** Keep a model line only when it does not invent or drop a gap. */
export function acceptMorningBriefText(
  text: string,
  gapCount: number,
  template: string,
  rhythmClause: string | null = null,
): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed === '') return template;
  const body = trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
  if (template.includes('精力偏低') && !body.includes('精力偏低')) return template;
  if (gapCount > 0) {
    if (!body.includes('空档') || !body.includes('建议')) return template;
    return withRhythmClause(body, gapCount, rhythmClause);
  }
  if (body.includes('空档')) return template;
  return body;
}

export function todayPageRecentlyOpen(context: unknown, now: Date): boolean {
  if (typeof context !== 'object' || context === null) return false;
  const raw = (context as { reportedAt?: unknown }).reportedAt;
  if (typeof raw !== 'string') return false;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return false;
  const delta = now.getTime() - at;
  return delta >= 0 && delta <= TODAY_PAGE_OPEN_MS;
}

/**
 * Today's brief clock, or `now` once that clock has passed.
 * Quiet hours move `scheduledAt`; a next-day landing is left for the caller to skip.
 */
export function morningBriefWhen(
  now: Date,
  timeZone: string,
  hm: string,
  quietStart: string | null,
  quietEnd: string | null,
): { day: string; scheduledAt: Date } | null {
  const local = DateTime.fromJSDate(now, { zone: timeZone });
  const day = local.toISODate();
  if (!local.isValid || !day) return null;
  const { hour, minute } = parseHHmm(briefHm(hm));
  const slot = local.set({ hour, minute, second: 0, millisecond: 0 });
  const instant = slot.toMillis() > now.getTime() ? slot.toJSDate() : now;
  return {
    day,
    scheduledAt: applyQuietHours(instant, quietStart, quietEnd, timeZone),
  };
}

function meetingsOf(context: unknown): MorningMeeting[] {
  if (typeof context !== 'object' || context === null) return [];
  const meetings = (context as { meetings?: unknown }).meetings;
  if (typeof meetings !== 'object' || meetings === null) return [];
  const row = meetings as { status?: unknown; events?: unknown };
  if (row.status !== 'events' || !Array.isArray(row.events)) return [];
  const out: MorningMeeting[] = [];
  for (const event of row.events) {
    if (typeof event !== 'object' || event === null) continue;
    const item = event as { title?: unknown; start?: unknown; allDay?: unknown };
    if (typeof item.title !== 'string' || item.title.trim() === '') continue;
    out.push({
      title: item.title.trim(),
      start: typeof item.start === 'string' ? item.start : '',
      allDay: item.allDay === true,
    });
  }
  return out;
}

function weatherLine(context: unknown): string | null {
  if (typeof context !== 'object' || context === null) return null;
  const weather = (context as { weather?: unknown }).weather;
  if (typeof weather !== 'object' || weather === null) return null;
  const row = weather as { status?: unknown; place?: unknown; condition?: unknown; temperatureC?: unknown };
  if (row.status !== 'ready') return null;
  const place = typeof row.place === 'string' ? row.place : '';
  const condition = typeof row.condition === 'string' ? row.condition : '';
  const temp = typeof row.temperatureC === 'number' ? `${String(Math.round(row.temperatureC))}°C` : '';
  const line = [place, condition, temp].filter((part) => part !== '').join(' ');
  return line === '' ? null : line;
}

async function loadTodayTasks(userId: string, timeZone: string, now: Date) {
  const local = DateTime.fromJSDate(now, { zone: timeZone });
  if (!local.isValid) return [];
  const start = local.startOf('day').toJSDate();
  const end = local.plus({ days: 1 }).startOf('day').toJSDate();
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['todo', 'doing']),
        or(
          and(isNotNull(tasks.dueAt), lt(tasks.dueAt, end)),
          and(isNotNull(tasks.startAt), gte(tasks.startAt, start), lt(tasks.startAt, end)),
        ),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    startAt: row.startAt ? row.startAt.toISOString() : null,
    habitId: row.habitId,
    deletedAt: null,
    priority: briefingPriority(row.priority),
    isAllDay: row.isAllDay,
  }));
}

function briefingPriority(value: number): 0 | 1 | 2 | 3 {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  return 3;
}

async function loadFacts(user: User, now: Date): Promise<{ facts: MorningBriefFacts; context: unknown }> {
  const zone = user.timezone || 'Asia/Shanghai';
  const [open, layout] = await Promise.all([
    loadTodayTasks(user.id, zone, now),
    getDb().select().from(todayLayouts).where(eq(todayLayouts.userId, user.id)).limit(1),
  ]);
  const context = layout[0]?.context ?? {};
  const lowEnergy = await hasLowEnergySafe(user.id, zone, now, 'morning');
  return {
    context,
    facts: {
      plan: buildTodayPlan(open, zone, now),
      meetings: meetingsOf(context),
      weather: weatherLine(context),
      lowEnergy,
    },
  };
}

function promptFor(facts: MorningBriefFacts, template: string, rhythmClause: string | null): string {
  const gaps = meetingGaps(facts.meetings);
  const gapText = gaps.length === 0
    ? '无'
    : gaps.map((gap) => `${gap.after} → ${gap.before} ${String(gap.minutes)} 分钟`).join('；');
  const meetings = facts.meetings.length === 0
    ? '无'
    : facts.meetings.map((item) => (item.allDay ? `${item.title} 全天` : `${item.title} ${item.start}`)).join('；');
  const focus = facts.plan.items.map((item) => `${item.title}（${item.mark}）`).join('；') || '无';
  return [
    `未完成 ${String(openCount(facts.plan))} 件，逾期 ${String(facts.plan.counts.overdue)} 件`,
    `优先：${focus}`,
    `日程：${meetings}`,
    `空档（相邻日程开始时刻之差，至少 60 分钟）：${gapText}`,
    `天气：${facts.weather ?? '无'}`,
    ...(facts.lowEnergy
      ? [`精力：昨天或今天有 ≤${String(ENERGY_LOW_MAX)} 的记录。必须保留底稿里的「精力偏低」和要挪的标题。`]
      : []),
    ...(rhythmClause ? [`节奏画像（建议时段时原句引用）：${rhythmClause}`] : []),
    `规则底稿：${template}`,
  ].join('\n');
}

async function modelReady(userId: string): Promise<boolean> {
  if (completeOverride) return true;
  return resolveModelFor(await loadLlmStore(userId), 'agent.briefing') !== null;
}

async function completeBrief(user: User, prompt: string): Promise<string | null> {
  if (completeOverride) return completeOverride(user, prompt);
  const result = await completeText(user, 'agent.briefing', {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });
  return result?.text ?? null;
}

async function composeMessage(user: User, facts: MorningBriefFacts, now: Date): Promise<string> {
  const gaps = meetingGaps(facts.meetings);
  let clause: string | null = null;
  if (!morningBriefIsShort(facts) && gaps.length > 0) {
    const profile = await loadRhythmProfileSafe(user.id);
    const weekday = DateTime.fromJSDate(now, { zone: user.timezone || 'Asia/Shanghai' }).weekday;
    clause = rhythmBriefClause(profile, weekday);
  }
  const template = morningBriefTemplate(facts, clause);
  if (morningBriefIsShort(facts)) return template;
  if (!(await modelReady(user.id))) return template;
  try {
    await getDb().transaction((tx) => reserveBackgroundModelCall(tx, user.id, now));
  } catch (err) {
    if (err instanceof DeferredAgentJobError) {
      logger.info('morning brief template fallback', { userId: user.id, reason: 'DAILY_MODEL_BUDGET' });
      return template;
    }
    throw err;
  }
  try {
    const text = await completeBrief(user, promptFor(facts, template, clause));
    if (!text) return template;
    return acceptMorningBriefText(text, gaps.length, template, clause);
  } catch (err) {
    logger.info('morning brief template fallback', {
      userId: user.id,
      reason: err instanceof Error ? err.name : 'error',
    });
    return template;
  }
}

/**
 * One pending row per user per local day, at their morning brief clock.
 * A quiet-hours delay that lands tomorrow is skipped so it does not double with the next day.
 * Existing rows are left alone.
 */
export async function enqueueMorningBriefs(now = new Date()): Promise<number> {
  const people = await getDb().select().from(users).where(eq(users.notifyMorningBrief, true));
  let inserted = 0;
  for (const user of people) {
    const zone = user.timezone || 'Asia/Shanghai';
    const slot = morningBriefWhen(now, zone, briefHm(user.morningBriefTime), user.quietHoursStart, user.quietHoursEnd);
    if (!slot) continue;
    const firedDay = DateTime.fromJSDate(slot.scheduledAt, { zone }).toISODate();
    if (firedDay !== slot.day) continue;
    const payload: NotificationOutboxPayload = {
      title: '晨报',
      listId: '',
      listName: '',
      dueAt: null,
      remindAt: null,
      isAllDay: false,
      timezone: zone,
      eventType: 'agent.briefing',
      message: '晨报',
    };
    const rows = await getDb()
      .insert(notificationOutbox)
      .values({
        id: randomUUID(),
        userId: user.id,
        eventType: 'agent.briefing',
        entityType: 'user',
        entityId: user.id,
        occurrenceAt: slot.scheduledAt,
        idempotencyKey: `agent.briefing:${user.id}:${slot.day}`,
        scheduledAt: slot.scheduledAt,
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: null,
        lastError: null,
        payload,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: notificationOutbox.id });
    inserted += rows.length;
  }
  return inserted;
}

async function cancel(id: string, now: Date, lastError: string): Promise<void> {
  await getDb()
    .update(notificationOutbox)
    .set({ status: 'cancelled', updatedAt: now, lastError })
    .where(claimed(id));
}

/** Fill the body at send time. `stop` means the row was cancelled or pushed back. */
export async function prepareMorningBrief(
  user: User,
  job: NotificationOutboxRow,
  now: Date,
): Promise<'ready' | 'stop'> {
  const zone = user.timezone || 'Asia/Shanghai';
  if (!user.notifyMorningBrief) {
    await cancel(job.id, now, 'morning brief off');
    return 'stop';
  }
  const local = DateTime.fromJSDate(now, { zone });
  if (!local.isValid) {
    await cancel(job.id, now, 'invalid timezone');
    return 'stop';
  }
  const quietUntil = applyQuietHours(now, user.quietHoursStart, user.quietHoursEnd, zone);
  if (quietUntil.getTime() > now.getTime() + 1_000) {
    const sameDay = DateTime.fromJSDate(quietUntil, { zone }).toISODate() === local.toISODate();
    if (!sameDay) {
      await cancel(job.id, now, 'quiet hours crossed midnight');
      return 'stop';
    }
    await getDb()
      .update(notificationOutbox)
      .set({ status: 'pending', scheduledAt: quietUntil, updatedAt: now })
      .where(claimed(job.id));
    return 'stop';
  }
  const { facts, context } = await loadFacts(user, now);
  if (todayPageRecentlyOpen(context, now)) {
    await cancel(job.id, now, 'today page open');
    return 'stop';
  }
  const message = await composeMessage(user, facts, now);
  const payload: NotificationOutboxPayload = {
    ...job.payload,
    eventType: 'agent.briefing',
    title: '晨报',
    timezone: zone,
    message,
  };
  const updated = await getDb()
    .update(notificationOutbox)
    .set({ payload, updatedAt: now })
    .where(claimed(job.id))
    .returning({ id: notificationOutbox.id });
  if (updated.length === 0) return 'stop';
  job.payload = payload;
  return 'ready';
}
