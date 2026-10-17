import { randomUUID } from 'node:crypto';
import { WEEKLY_INSIGHT_HEADING, renderReportTemplate } from '@vital/dto';
import { and, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { runProposalPass } from '../agent/harness.js';
import {
  DeferredAgentJobError,
  LostAgentJobLeaseError,
  withAgentJobEffects,
  type AgentJobTransaction,
} from '../agent/job-runtime.js';
import { reserveBackgroundModelCall } from '../agent/model-budget.js';
import { submitNotificationTool, type SubmitNotificationArgs } from '../agent/tools.js';
import { executionResult, skipExecution } from '../agent/executions.service.js';
import { getDb } from '../db/index.js';
import {
  habits,
  inboxItemTags,
  inboxItems,
  notificationOutbox,
  outcomes,
  reports,
  tags,
  taskCompletions,
  tasks,
  users,
  type AgentJobRow,
  type NotificationOutboxPayload,
  type User,
} from '../db/schema.js';
import { resolveModelFor } from '../llm/pi.js';
import { loadLlmStore } from '../llm/store.js';
import { logger } from '../utils/logger.js';
import { currentPeriod, periodInstants, previousPeriodStart, type PeriodBounds } from '../reports/period.js';
import { loadWeeklyGoalEntries, renderWeeklyGoals, replaceWeeklyGoals, syncWeeklyGoals } from '../reports/weekly-goals.js';
import { applyQuietHours } from './quiet-hours.js';
import { loadEnergyDayLinks } from '../energy/energy.service.js';
import { energyCompletionLink, energyLinkSentence, preferEnergyPattern } from './energy-link.js';
import { titleTokens } from './meeting-prep.js';

/** Last evening of the user's week. Default weekStartsOn=1 → Sunday. */
export const WEEKLY_OBSERVE_HOUR = 18;

/** Local hours [23:00, 05:00). */
export const LATE_NIGHT_MIN = 5;
export const INBOX_TOPIC_MIN = 4;
export const DEFER_TOPIC_MIN = 4;
export const HABIT_DRIFT_HOURS = 2;
export const HABIT_SAMPLE_MIN = 3;

export const WEEKLY_OBSERVE_TITLE = '本周洞察';
export const WEEKLY_OBSERVE_FALLBACK_PATH = '/reports?type=weekly';

const INSIGHT_H2 = `## ${WEEKLY_INSIGHT_HEADING}`;
const NOTES_H2 = '## 复盘';
const H2 = /^## /;
const OPEN_STATUS = ['todo', 'doing'] as const;

const SYSTEM_PROMPT = `你把每周观察改写成最多两句中文。只使用给出的数字和名称，不编造任务、文章或习惯。不要标题，不要列表。必须调用 submit_notification。`;

export type ObserveKind = 'late_night' | 'defer' | 'habit_drift' | 'inbox' | 'energy' | 'milestone' | 'outcome_alert';

export interface ObservePattern {
  kind: ObserveKind;
  text: string;
  /** Names the rewrite must keep. Counts are checked against the rule text. */
  anchors: string[];
}

export interface WeeklyObserveStats {
  lateNightCreated: number;
  inbox: { topic: string; count: number } | null;
  /**
   * Top topic among open tasks touched this week. deferCount is cumulative:
   * there is no per-defer event, so the sentence says 累计.
   */
  defer: { topic: string; deferCount: number } | null;
  habit: { name: string; hours: number; direction: 'later' | 'earlier' } | null;
  /** Open milestones not touched this week. Empty means there is nothing to say. */
  stalledMilestones: { outcome: string; title: string }[];
  /** Open outcomes whose stored ruleSignal is alert. Not invented. */
  alertOutcomes: { name: string; nextStep: string | null }[];
}

export interface WeeklyObserveSample {
  timeZone: string;
  createdAt: Date[];
  inbox: { title: string; tags: string[] }[];
  defer: { title: string; outcomeName: string | null; deferCount: number }[];
  habits: { name: string; completedAt: Date; week: 'this' | 'prev' }[];
  stalledMilestones?: { outcome: string; title: string }[];
  alertOutcomes?: { name: string; nextStep: string | null }[];
}

type WeeklyRewrite = (user: User, rule: string) => Promise<string | null>;

let rewriteOverride: WeeklyRewrite | null = null;

/** Test seam. Production leaves this null and calls agent.observe. */
export function setWeeklyObserveRewrite(next: WeeklyRewrite | null): void {
  rewriteOverride = next;
}

export function weeklyObserveKey(userId: string, periodStart: string): string {
  return `agent.observe:${userId}:${periodStart}`;
}

export function weeklyObserveDedupKey(userId: string, periodStart: string): string {
  return `reflect.weekly:${userId}:${periodStart}`;
}

export function weeklyObservePath(reportId: string): string {
  return `/reports/${reportId}?type=weekly`;
}

export function isLateNight(instant: Date, timeZone: string): boolean {
  const local = DateTime.fromJSDate(instant, { zone: timeZone });
  if (!local.isValid) return false;
  return local.hour >= 23 || local.hour < 5;
}

function clip(value: string): string {
  return value.trim().slice(0, 40);
}

function deferTopic(row: { title: string; outcomeName: string | null }): string {
  const named = row.outcomeName?.trim();
  if (named) return clip(named);
  const token = titleTokens(row.title)[0];
  if (token) return clip(token);
  return clip(row.title);
}

function inboxTopics(row: { title: string; tags: string[] }): string[] {
  const named = [...new Set(row.tags.map((tag) => tag.trim()).filter((tag) => tag !== ''))];
  if (named.length > 0) return named.map(clip);
  return [...new Set(titleTokens(row.title))];
}

function topCount(counts: Map<string, number>): { topic: string; count: number } | null {
  let best: { topic: string; count: number } | null = null;
  for (const [topic, count] of counts) {
    if (topic === '' || count <= 0) continue;
    if (!best || count > best.count || (count === best.count && topic.localeCompare(best.topic, 'zh') < 0)) {
      best = { topic, count };
    }
  }
  return best;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (right === undefined) return 0;
  if (sorted.length % 2 === 1) return right;
  return Math.round(((left ?? right) + right) / 2);
}

/** Shortest signed hour delta in [-12, 12]. Positive means this week is later. */
function wrapHourDelta(thisHour: number, prevHour: number): number {
  let delta = thisHour - prevHour;
  if (delta > 12) delta -= 24;
  if (delta < -12) delta += 24;
  return delta;
}

export function weeklyObserveStats(sample: WeeklyObserveSample): WeeklyObserveStats {
  let lateNightCreated = 0;
  for (const instant of sample.createdAt) {
    if (isLateNight(instant, sample.timeZone)) lateNightCreated += 1;
  }

  const inboxCounts = new Map<string, number>();
  for (const item of sample.inbox) {
    for (const topic of inboxTopics(item)) {
      inboxCounts.set(topic, (inboxCounts.get(topic) ?? 0) + 1);
    }
  }
  const inboxTop = topCount(inboxCounts);

  const deferCounts = new Map<string, number>();
  for (const row of sample.defer) {
    if (row.deferCount <= 0) continue;
    const topic = deferTopic(row);
    if (topic === '') continue;
    deferCounts.set(topic, (deferCounts.get(topic) ?? 0) + row.deferCount);
  }
  const deferTop = topCount(deferCounts);

  const byHabit = new Map<string, { thisWeek: number[]; prev: number[] }>();
  for (const row of sample.habits) {
    const name = clip(row.name);
    if (name === '') continue;
    const hour = DateTime.fromJSDate(row.completedAt, { zone: sample.timeZone }).hour;
    if (!Number.isFinite(hour)) continue;
    const bucket = byHabit.get(name) ?? { thisWeek: [], prev: [] };
    if (row.week === 'this') bucket.thisWeek.push(hour);
    else bucket.prev.push(hour);
    byHabit.set(name, bucket);
  }
  let habit: WeeklyObserveStats['habit'] = null;
  for (const [name, bucket] of byHabit) {
    if (bucket.thisWeek.length < HABIT_SAMPLE_MIN || bucket.prev.length < HABIT_SAMPLE_MIN) continue;
    const delta = wrapHourDelta(median(bucket.thisWeek), median(bucket.prev));
    const hours = Math.abs(delta);
    if (hours < HABIT_DRIFT_HOURS) continue;
    if (!habit || hours > habit.hours || (hours === habit.hours && name.localeCompare(habit.name, 'zh') < 0)) {
      habit = { name, hours, direction: delta > 0 ? 'later' : 'earlier' };
    }
  }

  return {
    lateNightCreated,
    inbox: inboxTop,
    defer: deferTop ? { topic: deferTop.topic, deferCount: deferTop.count } : null,
    habit,
    stalledMilestones: sample.stalledMilestones ?? [],
    alertOutcomes: sample.alertOutcomes ?? [],
  };
}

/** One follow-up. Stalled milestones win. No sentence when nothing stalled and nothing is alert. */
export function goalObservePattern(stats: WeeklyObserveStats): ObservePattern | null {
  if (stats.stalledMilestones.length > 0) {
    const stalled = [...stats.stalledMilestones].sort(
      (a, b) => a.outcome.localeCompare(b.outcome, 'zh') || a.title.localeCompare(b.title, 'zh'),
    );
    const shown = stalled.slice(0, 3);
    const names = [...new Set(shown.map((item) => item.outcome))];
    const outcomeLabel = names.map((name) => `「${name}」`).join('、');
    const titles = shown.map((item) => `「${clip(item.title)}」`).join('、');
    const extra = stalled.length > shown.length ? `等 ${String(stalled.length)} 个` : '';
    return {
      kind: 'milestone',
      text: `${outcomeLabel}有 ${String(stalled.length)} 个里程碑这周没动：${titles}${extra === '' ? '' : `，${extra}`}。`,
      anchors: [...names, ...shown.map((item) => clip(item.title))],
    };
  }
  const alert = [...stats.alertOutcomes].sort((a, b) => a.name.localeCompare(b.name, 'zh'))[0];
  if (!alert) return null;
  const text = alert.nextStep
    ? `「${alert.name}」这周需要推一把。下一步是「${alert.nextStep}」。`
    : `「${alert.name}」这周需要推一把。`;
  return {
    kind: 'outcome_alert',
    text,
    anchors: alert.nextStep ? [alert.name, alert.nextStep] : [alert.name],
  };
}

/** Goal follow-up sits after late-night and energy, still inside the two-pattern cap. */
export function preferGoalPattern<T extends { kind: string }>(
  patterns: readonly T[],
  goal: T | null,
  cap = 2,
): T[] {
  if (!goal) return patterns.slice(0, cap);
  const rest = patterns.filter((pattern) => pattern.kind !== 'milestone' && pattern.kind !== 'outcome_alert');
  const head = rest.filter((pattern) => pattern.kind === 'late_night' || pattern.kind === 'energy');
  const others = rest.filter((pattern) => pattern.kind !== 'late_night' && pattern.kind !== 'energy');
  return [...head, goal, ...others].slice(0, cap);
}

export function detectWeeklyPatterns(stats: WeeklyObserveStats): ObservePattern[] {
  const found: ObservePattern[] = [];
  if (stats.lateNightCreated >= LATE_NIGHT_MIN) {
    found.push({
      kind: 'late_night',
      text: `这周晚上 11 点后建了 ${String(stats.lateNightCreated)} 个任务——是不是焦虑性记录？`,
      anchors: [],
    });
  }
  if (stats.defer && stats.defer.deferCount >= DEFER_TOPIC_MIN) {
    found.push({
      kind: 'defer',
      text: `「${stats.defer.topic}」相关的事累计推迟了 ${String(stats.defer.deferCount)} 次，这周还在往后推。`,
      anchors: [stats.defer.topic],
    });
  }
  if (stats.habit && stats.habit.hours >= HABIT_DRIFT_HOURS) {
    const way = stats.habit.direction === 'later' ? '晚' : '早';
    found.push({
      kind: 'habit_drift',
      text: `「${stats.habit.name}」的打卡这周比上周${way}了约 ${String(stats.habit.hours)} 小时。`,
      anchors: [stats.habit.name],
    });
  }
  if (stats.inbox && stats.inbox.count >= INBOX_TOPIC_MIN) {
    found.push({
      kind: 'inbox',
      text: `这周未读的「${stats.inbox.topic}」攒了 ${String(stats.inbox.count)} 条。`,
      anchors: [stats.inbox.topic],
    });
  }
  return found.slice(0, 2);
}

export function weeklyObserveMessage(patterns: readonly ObservePattern[]): string {
  return patterns.map((pattern) => pattern.text).join('\n');
}

/** Model-down path. An energy sentence is a conclusion and stays out. */
function ruleWithoutEnergy(patterns: readonly ObservePattern[]): string {
  return weeklyObserveMessage(patterns.filter((pattern) => pattern.kind !== 'energy'));
}

/** Keep a rewrite only when it preserves every number and name from the rule. */
export function acceptWeeklyObserveText(
  text: string,
  patterns: readonly ObservePattern[],
  rule: string,
): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed === '' || trimmed.length > 200 || trimmed.includes('##')) return rule;
  const allowed = new Set(rule.match(/\d+/g) ?? []);
  const used = trimmed.match(/\d+/g) ?? [];
  if (used.some((token) => !allowed.has(token))) return rule;
  for (const token of allowed) {
    if (!trimmed.includes(token)) return rule;
  }
  for (const pattern of patterns) {
    for (const anchor of pattern.anchors) {
      if (anchor !== '' && !trimmed.includes(anchor)) return rule;
    }
  }
  return trimmed;
}

export function replaceInsightSection(bodyMd: string, text: string): string {
  const trimmed = text.replace(/\n+$/, '').trim();
  if (trimmed === '') return bodyMd;
  const block = `${INSIGHT_H2}\n\n${trimmed}\n`;
  const idx = bodyMd.indexOf(INSIGHT_H2);
  if (idx >= 0) {
    const afterHeading = bodyMd.slice(idx + INSIGHT_H2.length);
    const afterLines = afterHeading.startsWith('\n') ? afterHeading.slice(1) : afterHeading;
    const lines = afterLines.split('\n');
    const cut = lines.findIndex((line) => H2.test(line));
    const tail = cut >= 0 ? `\n${lines.slice(cut).join('\n')}` : '';
    return `${bodyMd.slice(0, idx)}${block}${tail.replace(/^\n\n/, '\n')}`;
  }
  const notesIdx = bodyMd.indexOf(NOTES_H2);
  if (notesIdx >= 0) {
    const before = bodyMd.slice(0, notesIdx).replace(/\n+$/, '');
    return `${before}\n\n${block}\n${bodyMd.slice(notesIdx)}`;
  }
  return `${bodyMd.replace(/\n+$/, '')}\n\n${block}`;
}

/**
 * Fire time for the week that contains `now`: 18:00 on the last local day.
 * Before that instant the job waits; after it, the job is due immediately.
 */
export function weeklyObserveWhen(
  now: Date,
  timeZone: string,
  weekStartsOn: 0 | 1,
): { periodStart: string; periodEnd: string; scheduledAt: Date } | null {
  const zoned = DateTime.fromJSDate(now, { zone: timeZone });
  if (!zoned.isValid) return null;
  const period = currentPeriod('weekly', timeZone, weekStartsOn, zoned);
  const fire = DateTime.fromISO(period.end, { zone: timeZone })
    .minus({ days: 1 })
    .set({ hour: WEEKLY_OBSERVE_HOUR, minute: 0, second: 0, millisecond: 0 });
  if (!fire.isValid) return null;
  return {
    periodStart: period.start,
    periodEnd: period.end,
    scheduledAt: now.getTime() >= fire.toMillis() ? now : fire.toJSDate(),
  };
}

function periodFromPayload(user: User, job: AgentJobRow): PeriodBounds | null {
  const date = 'date' in job.payload ? job.payload.date : '';
  const anchor = DateTime.fromISO(date, { zone: user.timezone }).startOf('day');
  if (!anchor.isValid) return null;
  const weekStartsOn = user.weekStartsOn === 0 ? 0 : 1;
  const period = currentPeriod('weekly', user.timezone, weekStartsOn, anchor);
  if (period.start === '' || period.end === '') return null;
  return period;
}

function summarizeStats(stats: WeeklyObserveStats): string {
  const inbox = stats.inbox ? `${stats.inbox.topic} ${String(stats.inbox.count)}` : '无';
  const defer = stats.defer ? `${stats.defer.topic} ${String(stats.defer.deferCount)}` : '无';
  const habit = stats.habit
    ? `${stats.habit.name} ${stats.habit.direction === 'later' ? '晚' : '早'} ${String(stats.habit.hours)}`
    : '无';
  const stalled =
    stats.stalledMilestones.length === 0
      ? '无'
      : stats.stalledMilestones
          .slice(0, 5)
          .map((item) => `${item.outcome}/${item.title}`)
          .join('、');
  return `深夜新建 ${String(stats.lateNightCreated)}；未读主题 ${inbox}；推迟 ${defer}；打卡漂移 ${habit}；停滞里程碑 ${stalled}`;
}

function promptFor(patterns: readonly ObservePattern[]): string {
  return [
    '聚合统计（只含已判定的模式，不是原始清单）：',
    ...patterns.map((pattern, index) => `${String(index + 1)}. ${pattern.text}`),
    '',
    '只改写这些句子，保留数字和名称。',
  ].join('\n');
}

async function loadSample(user: User, period: PeriodBounds): Promise<WeeklyObserveSample> {
  const db = getDb();
  const bounds = periodInstants(period.start, period.end, user.timezone);
  const prevStartYmd = previousPeriodStart('weekly', period.start, user.timezone);
  const prevBounds = periodInstants(prevStartYmd, period.start, user.timezone);

  const [created, unread, deferRows, checks, stalledRows, alertRows] = await Promise.all([
    db
      .select({ createdAt: tasks.createdAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, user.id),
          isNull(tasks.deletedAt),
          isNull(tasks.habitId),
          isNull(tasks.calendarKey),
          gte(tasks.createdAt, bounds.start),
          lt(tasks.createdAt, bounds.end),
        ),
      ),
    db
      .select({ id: inboxItems.id, title: inboxItems.title })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, user.id),
          isNull(inboxItems.deletedAt),
          eq(inboxItems.status, 'unread'),
          gte(inboxItems.capturedAt, bounds.start),
          lt(inboxItems.capturedAt, bounds.end),
        ),
      ),
    db
      .select({
        title: tasks.title,
        deferCount: tasks.deferCount,
        outcomeName: outcomes.name,
      })
      .from(tasks)
      .leftJoin(outcomes, and(eq(outcomes.id, tasks.outcomeId), eq(outcomes.userId, user.id)))
      .where(
        and(
          eq(tasks.userId, user.id),
          isNull(tasks.deletedAt),
          isNull(tasks.habitId),
          isNull(tasks.calendarKey),
          inArray(tasks.status, [...OPEN_STATUS]),
          gte(tasks.deferCount, 1),
          gte(tasks.updatedAt, bounds.start),
          lt(tasks.updatedAt, bounds.end),
        ),
      ),
    db
      .select({ name: habits.name, completedAt: taskCompletions.completedAt })
      .from(taskCompletions)
      .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
      .innerJoin(habits, and(eq(habits.id, tasks.habitId), eq(habits.userId, user.id)))
      .where(
        and(
          eq(tasks.userId, user.id),
          isNull(tasks.deletedAt),
          isNotNull(tasks.habitId),
          gte(taskCompletions.completedAt, prevBounds.start),
          lt(taskCompletions.completedAt, bounds.end),
        ),
      ),
    db
      .select({ title: tasks.title, outcomeName: outcomes.name })
      .from(tasks)
      .innerJoin(outcomes, and(eq(outcomes.id, tasks.outcomeId), eq(outcomes.userId, user.id)))
      .where(
        and(
          eq(tasks.userId, user.id),
          isNull(tasks.deletedAt),
          isNull(tasks.habitId),
          eq(tasks.isMilestone, true),
          inArray(tasks.status, [...OPEN_STATUS]),
          eq(outcomes.status, 'open'),
          lt(tasks.updatedAt, bounds.start),
        ),
      ),
    db
      .select({ name: outcomes.name, ruleNextStep: outcomes.ruleNextStep })
      .from(outcomes)
      .where(and(eq(outcomes.userId, user.id), eq(outcomes.status, 'open'), eq(outcomes.ruleSignal, 'alert'))),
  ]);

  const tagNames = new Map<string, string[]>();
  const ids = unread.map((item) => item.id);
  if (ids.length > 0) {
    const links = await db
      .select({ inboxItemId: inboxItemTags.inboxItemId, name: tags.name })
      .from(inboxItemTags)
      .innerJoin(tags, and(eq(tags.id, inboxItemTags.tagId), eq(tags.userId, user.id)))
      .where(inArray(inboxItemTags.inboxItemId, ids));
    for (const link of links) {
      const list = tagNames.get(link.inboxItemId) ?? [];
      list.push(link.name);
      tagNames.set(link.inboxItemId, list);
    }
  }

  return {
    timeZone: user.timezone,
    createdAt: created.map((row) => row.createdAt),
    inbox: unread.map((item) => ({ title: item.title, tags: tagNames.get(item.id) ?? [] })),
    defer: deferRows.map((row) => ({
      title: row.title,
      outcomeName: row.outcomeName,
      deferCount: row.deferCount,
    })),
    habits: checks.map((row) => ({
      name: row.name,
      completedAt: row.completedAt,
      week: row.completedAt < bounds.start ? 'prev' : 'this',
    })),
    stalledMilestones: stalledRows.flatMap((row) =>
      row.outcomeName ? [{ outcome: row.outcomeName, title: row.title }] : [],
    ),
    alertOutcomes: alertRows.map((row) => ({ name: row.name, nextStep: row.ruleNextStep })),
  };
}

async function composeMessage(
  user: User,
  patterns: ObservePattern[],
  rule: string,
  now: Date,
): Promise<string> {
  try {
    if (rewriteOverride) {
      await getDb().transaction((tx) => reserveBackgroundModelCall(tx, user.id, now));
      const text = await rewriteOverride(user, rule);
      if (!text || text.trim() === '') return ruleWithoutEnergy(patterns);
      return acceptWeeklyObserveText(text, patterns, rule);
    }
    if (resolveModelFor(await loadLlmStore(user.id), 'agent.observe') === null) return ruleWithoutEnergy(patterns);
    const result = await runProposalPass<SubmitNotificationArgs>({
      user,
      capability: 'agent.observe',
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: promptFor(patterns),
      makeTool: submitNotificationTool,
    });
    if (!result) return ruleWithoutEnergy(patterns);
    return acceptWeeklyObserveText(result.args.message, patterns, rule);
  } catch (err) {
    if (err instanceof LostAgentJobLeaseError) throw err;
    logger.info('weekly observe rule fallback', {
      userId: user.id,
      reason: err instanceof DeferredAgentJobError ? 'DAILY_MODEL_BUDGET' : err instanceof Error ? err.name : 'error',
    });
    return ruleWithoutEnergy(patterns);
  }
}

async function ensureReport(
  tx: AgentJobTransaction,
  user: User,
  period: PeriodBounds,
  now: Date,
): Promise<{ id: string; bodyMd: string; revision: number }> {
  const [existing] = await tx
    .select()
    .from(reports)
    .where(and(eq(reports.userId, user.id), eq(reports.type, 'weekly'), eq(reports.periodStart, period.start)))
    .for('update');
  if (existing) return { id: existing.id, bodyMd: existing.bodyMd, revision: existing.revision };
  const rendered = renderReportTemplate('weekly', period.label);
  const id = randomUUID();
  await tx
    .insert(reports)
    .values({
      id,
      userId: user.id,
      type: 'weekly',
      periodStart: period.start,
      periodEnd: period.end,
      title: rendered.title,
      bodyMd: rendered.bodyMd,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [reports.userId, reports.type, reports.periodStart] });
  const [row] = await tx
    .select()
    .from(reports)
    .where(and(eq(reports.userId, user.id), eq(reports.type, 'weekly'), eq(reports.periodStart, period.start)))
    .for('update');
  if (!row) throw new Error('weekly report missing after insert');
  return { id: row.id, bodyMd: row.bodyMd, revision: row.revision };
}

export async function processWeeklyObserve(job: AgentJobRow, user: User, now: Date): Promise<'done'> {
  const period = periodFromPayload(user, job);
  if (!period) {
    skipExecution('INVALID_PAYLOAD');
    return 'done';
  }
  const stats = weeklyObserveStats(await loadSample(user, period));
  const base = detectWeeklyPatterns(stats);
  let energy: ObservePattern | null = null;
  try {
    const conclusion = energyCompletionLink(
      await loadEnergyDayLinks(user.id, user.timezone, period.start, period.end),
    );
    if (conclusion) {
      energy = { kind: 'energy', text: energyLinkSentence(conclusion), anchors: [] };
    }
  } catch (err) {
    logger.info('weekly energy link skipped', {
      userId: user.id,
      reason: err instanceof Error ? err.name : 'error',
    });
  }
  let modelUp = false;
  if (energy) {
    try {
      modelUp =
        rewriteOverride !== null ||
        resolveModelFor(await loadLlmStore(user.id), 'agent.observe') !== null;
    } catch (err) {
      logger.info('weekly energy link skipped', {
        userId: user.id,
        reason: err instanceof Error ? err.name : 'error',
      });
      modelUp = false;
    }
  }
  const patterns = preferGoalPattern(
    preferEnergyPattern(base, modelUp ? energy : null),
    goalObservePattern(stats),
  );
  const energyNote = !energy
    ? '精力关联 不下结论'
    : modelUp
      ? '精力关联 纳入'
      : '精力关联 模型不可用，不下结论';
  executionResult({ inputSummary: `${summarizeStats(stats)}；${energyNote}`, targetType: 'report' });
  if (patterns.length === 0) {
    const [existing] = await getDb()
      .select()
      .from(reports)
      .where(and(eq(reports.userId, user.id), eq(reports.type, 'weekly'), eq(reports.periodStart, period.start)))
      .limit(1);
    if (existing) await syncWeeklyGoals(existing);
    skipExecution('NO_PATTERN');
    return 'done';
  }
  const rule = weeklyObserveMessage(patterns);
  const message = await composeMessage(user, patterns, rule, now);
  if (message.trim() === '') {
    skipExecution('NO_PATTERN');
    return 'done';
  }
  await withAgentJobEffects(job, async (tx) => {
    const [fresh] = await tx.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!fresh) return { reportId: null, pushed: false };
    const report = await ensureReport(tx, fresh, period, now);
    const goalSection = renderWeeklyGoals(
      await loadWeeklyGoalEntries(fresh.id, period.start, period.end, fresh.timezone),
    );
    const nextBody = replaceWeeklyGoals(replaceInsightSection(report.bodyMd, message), goalSection);
    if (nextBody !== report.bodyMd) {
      await tx
        .update(reports)
        .set({ bodyMd: nextBody, revision: report.revision + 1, updatedAt: now })
        .where(and(eq(reports.id, report.id), eq(reports.userId, fresh.id), eq(reports.revision, report.revision)));
    }
    if (!fresh.notifyWeeklyObserve) return { reportId: report.id, pushed: false };
    const scheduledAt = applyQuietHours(now, fresh.quietHoursStart, fresh.quietHoursEnd, fresh.timezone);
    const payload: NotificationOutboxPayload = {
      title: WEEKLY_OBSERVE_TITLE,
      listId: '',
      listName: '',
      dueAt: null,
      remindAt: null,
      isAllDay: false,
      timezone: fresh.timezone,
      eventType: 'agent.observe',
      message,
      deeplink: weeklyObservePath(report.id),
    };
    await tx
      .insert(notificationOutbox)
      .values({
        id: randomUUID(),
        userId: fresh.id,
        eventType: 'agent.observe',
        entityType: 'user',
        entityId: fresh.id,
        occurrenceAt: now,
        idempotencyKey: weeklyObserveKey(fresh.id, period.start),
        scheduledAt,
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: null,
        lastError: null,
        payload,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: notificationOutbox.idempotencyKey });
    return { reportId: report.id, pushed: true };
  });
  executionResult({ resultSummary: `已写入 ${String(patterns.length)} 条洞察` });
  return 'done';
}
