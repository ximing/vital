import { setTimeout as delay } from 'node:timers/promises';
import { DateTime } from 'luxon';
import {
  createTaskInputSchema,
  recurrenceKindSchema,
  taskPrioritySchema,
  type CreateTaskFromTextInput,
  type CreateTaskInput,
  type List,
  type RecurrenceKind,
  type ReminderOffsetMinutes,
  type Tag,
  type TaskPriority,
} from '@vital/dto';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { User } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { completeText } from './pi.js';

const OFFSETS = new Set<number>([5, 15, 30, 60, 1440]);

const FREQ_KINDS = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
} as const;
type IntervalFreq = keyof typeof FREQ_KINDS;

/** A bad interval must not fail the whole parse; the sentence can still carry it. */
function recurrenceIntervalOf(value: unknown): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > 365) return undefined;
  return n;
}

const REMINDER_VALUES = ['none', 'due', '5', '15', '30', '60', '1440'] as const;
type ExtractedReminder = (typeof REMINDER_VALUES)[number];

/** A bad reminder must not fail the whole parse. */
function reminderOfRaw(value: unknown): ExtractedReminder | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const token = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  return (REMINDER_VALUES as readonly string[]).includes(token) ? (token as ExtractedReminder) : undefined;
}

function booleanOf(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** Unknown kinds become null so a spoken interval can still be applied. */
function recurrenceKindOf(value: unknown): RecurrenceKind | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = recurrenceKindSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const extractedSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  notes: z.string().max(50_000).nullable().optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: z.string().nullable().optional(),
  dueTime: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  isAllDay: z.preprocess(booleanOf, z.boolean().optional()),
  someday: z.preprocess(booleanOf, z.boolean().optional()),
  reminder: z.preprocess(reminderOfRaw, z.enum(REMINDER_VALUES).optional()),
  recurrenceKind: z.preprocess(recurrenceKindOf, recurrenceKindSchema.nullable().optional()),
  recurrenceInterval: z.preprocess(
    recurrenceIntervalOf,
    z.number().int().min(1).max(365).optional(),
  ),
  listName: z.string().trim().min(1).max(80).nullable().optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type ExtractedTask = z.infer<typeof extractedSchema>;

export function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw AppError.of(502, 'LLM_UNAVAILABLE');
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    throw AppError.of(502, 'LLM_UNAVAILABLE');
  }
}

function ymdOf(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? null;
}

function hmOf(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value.trim());
  const hour = match?.[1];
  const minute = match?.[2];
  if (hour === undefined || minute === undefined) return null;
  return `${hour}:${minute}`;
}

export function extractedOf(raw: unknown): ExtractedTask {
  const parsed = extractedSchema.safeParse(raw);
  if (!parsed.success) throw AppError.of(502, 'LLM_UNAVAILABLE');
  const data = parsed.data;
  return {
    ...data,
    dueDate: ymdOf(data.dueDate),
    startDate: ymdOf(data.startDate),
    dueTime: hmOf(data.dueTime),
    startTime: hmOf(data.startTime),
  };
}

function wallIso(ymd: string, hm: string | null, zone: string): string {
  const time = hm ?? '00:00';
  const dt = DateTime.fromISO(`${ymd}T${time}:00`, { zone });
  if (!dt.isValid) throw AppError.of(400, 'VALIDATION_ERROR');
  const iso = dt.toUTC().toISO();
  if (!iso) throw AppError.of(400, 'VALIDATION_ERROR');
  return iso;
}

function todayYmd(zone: string, now: Date): string {
  return DateTime.fromJSDate(now).setZone(zone).toFormat('yyyy-MM-dd');
}

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

function zhInt(raw: string): number | null {
  if (/^\d{1,3}$/.test(raw)) {
    const n = Number(raw);
    return n >= 1 && n <= 365 ? n : null;
  }
  if (raw === '十') return 10;
  const tens = /^([一二三四五六七八九两])?十([一二三四五六七八九])?$/.exec(raw);
  if (tens) {
    const hi = tens[1] === undefined ? 1 : ZH_DIGIT[tens[1]];
    const lo = tens[2] === undefined ? 0 : ZH_DIGIT[tens[2]];
    if (hi === undefined || lo === undefined || hi === 0) return null;
    const n = hi * 10 + lo;
    return n >= 1 && n <= 365 ? n : null;
  }
  const digit = ZH_DIGIT[raw];
  return digit !== undefined && digit >= 1 ? digit : null;
}

const SPOKEN_REPEAT =
  /(?:每间隔|每隔|每)\s*(\d{1,3}|[零〇一二三四五六七八九十两]{1,3})\s*个?\s*(星期|礼拜|天|日|周|月|年)/;

/** Explicit 每隔/每间隔 N with N>1. Interval 1 stays with the model. */
function spokenRepeat(text: string): { freq: IntervalFreq; interval: number } | null {
  const match = SPOKEN_REPEAT.exec(text);
  const raw = match?.[1];
  const unit = match?.[2];
  if (raw === undefined || unit === undefined) return null;
  const interval = zhInt(raw);
  if (interval === null || interval <= 1) return null;
  const freq: IntervalFreq =
    unit === '天' || unit === '日' ? 'daily' : unit === '月' ? 'monthly' : unit === '年' ? 'yearly' : 'weekly';
  return { freq, interval };
}

function hourNum(raw: string): number | null {
  if (/^\d{1,2}$/.test(raw)) {
    const n = Number(raw);
    return n >= 0 && n <= 23 ? n : null;
  }
  if (raw === '十') return 10;
  if (raw === '十一') return 11;
  if (raw === '十二') return 12;
  const digit = ZH_DIGIT[raw];
  return digit !== undefined && digit >= 1 ? digit : null;
}

function wallHour(period: string, hour: number): number | null {
  if (hour >= 13 && hour <= 23) return hour;
  if (hour < 0 || hour > 12) return null;
  if (period === '凌晨') return hour === 12 ? 0 : hour;
  if (period === '早上' || period === '上午') return hour;
  if (period === '中午') {
    if (hour === 12) return 12;
    if (hour >= 1 && hour <= 2) return hour + 12;
    return hour;
  }
  if (period === '下午') return hour === 12 ? 12 : hour + 12;
  if (hour === 12) return 0;
  return hour + 12;
}

function minuteNum(phrase: string | undefined, raw: string | undefined): number | null {
  if (phrase === undefined) return 0;
  if (phrase === '半') return 30;
  if (phrase === '一刻') return 15;
  if (phrase === '三刻') return 45;
  if (raw === undefined) return null;
  const n = zhInt(raw);
  if (n === null || n > 59) return null;
  return n;
}

const SPOKEN_CLOCK =
  /(凌晨|早上|上午|中午|下午|傍晚|晚上|夜晚)\s*(十二|十一|十|\d{1,2}|[一二三四五六七八九两])\s*点\s*(半|一刻|三刻|(\d{1,2}|[零〇一二三四五六七八九十两]{1,3})分)?/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Clock from the sentence when the model left dueTime empty. */
function spokenHm(text: string): string | null {
  const clock = SPOKEN_CLOCK.exec(text);
  if (clock?.[1] !== undefined && clock[2] !== undefined) {
    const hour = hourNum(clock[2]);
    const minute = minuteNum(clock[3], clock[4]);
    if (hour !== null && minute !== null) {
      const wall = wallHour(clock[1], hour);
      if (wall !== null) return `${pad2(wall)}:${pad2(minute)}`;
    }
  }
  const colon = /(?:^|[^\d])([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/.exec(text);
  if (colon?.[1] !== undefined && colon[2] !== undefined) return `${pad2(Number(colon[1]))}:${colon[2]}`;
  return null;
}

type ResolvedRepeat =
  | { mode: 'none' }
  | { mode: 'kind'; kind: RecurrenceKind }
  | { mode: 'rrule'; rrule: string };

function isIntervalFreq(kind: RecurrenceKind): kind is IntervalFreq {
  return kind === 'daily' || kind === 'weekly' || kind === 'monthly' || kind === 'yearly';
}

function rruleOf(freq: IntervalFreq, interval: number): string {
  return `FREQ=${FREQ_KINDS[freq]};INTERVAL=${String(interval)}`;
}

function resolveRepeat(text: string, extracted: ExtractedTask | null): ResolvedRepeat {
  const spoken = spokenRepeat(text);
  if (spoken) return { mode: 'rrule', rrule: rruleOf(spoken.freq, spoken.interval) };
  const kind = extracted?.recurrenceKind ?? null;
  if (kind === null) return { mode: 'none' };
  const interval = extracted?.recurrenceInterval;
  if (interval !== undefined && interval > 1 && isIntervalFreq(kind)) {
    return { mode: 'rrule', rrule: rruleOf(kind, interval) };
  }
  return { mode: 'kind', kind };
}

function matchListId(name: string | null | undefined, lists: List[]): string | undefined {
  if (name === null || name === undefined || name === '') return undefined;
  const needle = name.trim().toLowerCase();
  const hit = lists.find(
    (item) =>
      (item.kind === 'inbox' || item.kind === 'user') &&
      !item.isArchived &&
      item.name.trim().toLowerCase() === needle,
  );
  return hit?.id;
}

function matchTagIds(names: string[] | undefined, tags: Tag[]): string[] | undefined {
  if (names === undefined || names.length === 0) return undefined;
  const byName = new Map(tags.map((tag) => [tag.name.trim().toLowerCase(), tag.id]));
  const ids: string[] = [];
  for (const name of names) {
    const id = byName.get(name.trim().toLowerCase());
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids.length > 0 ? ids : undefined;
}

function reminderOf(
  reminder: ExtractedTask['reminder'],
  hasDue: boolean,
): {
  reminderMode?: CreateTaskInput['reminderMode'];
  reminderOffsetMinutes?: ReminderOffsetMinutes | null;
} {
  if (reminder === undefined || reminder === 'none' || !hasDue) return {};
  if (reminder === 'due') return { reminderMode: 'due' };
  const minutes = Number(reminder);
  if (!OFFSETS.has(minutes)) return {};
  return {
    reminderMode: 'offset',
    reminderOffsetMinutes: minutes as ReminderOffsetMinutes,
  };
}

export type IntentContext = {
  lists: List[];
  tags: Tag[];
  inboxId: string;
  now?: Date;
};

export function buildCreateInputFromIntent(
  input: CreateTaskFromTextInput,
  extracted: ExtractedTask | null,
  ctx: IntentContext,
): CreateTaskInput {
  const zone = input.timezone ?? 'UTC';
  const now = ctx.now ?? new Date();
  const title = (extracted?.title ?? input.text).trim().slice(0, 500);
  const matchedList = matchListId(extracted?.listName, ctx.lists);
  const listId = matchedList ?? input.listId ?? ctx.inboxId;

  let notes: string | null | undefined = extracted?.notes;
  if ((notes === undefined || notes === null || notes === '') && input.text.trim() !== title) {
    if (input.text.trim().length > title.length + 8) notes = input.text.trim();
  }

  let dueYmd = extracted?.dueDate ?? input.dueYmd ?? null;
  const dueHm = extracted?.dueTime ?? spokenHm(input.text);
  const startYmd = extracted?.startDate ?? null;
  const startHm = extracted?.startTime ?? null;
  const repeat = resolveRepeat(input.text, extracted);

  let dueAt: string | null | undefined;
  let startAt: string | null | undefined;
  let isAllDay: boolean | undefined;

  // A repeat that only names a clock starts today at that time, not all-day.
  if (dueYmd === null && dueHm !== null && repeat.mode !== 'none') {
    dueYmd = todayYmd(zone, now);
  }

  if (dueYmd) {
    const timed = dueHm !== null;
    isAllDay = timed ? false : (extracted?.isAllDay ?? true);
    dueAt = wallIso(dueYmd, timed ? dueHm : null, zone);
  }
  if (startYmd) {
    const timed = startHm !== null;
    const startAllDay = extracted?.isAllDay ?? !timed;
    startAt = wallIso(startYmd, startAllDay ? null : startHm, zone);
    if (isAllDay === undefined) isAllDay = startAllDay;
  }

  if (dueAt === undefined && startAt === undefined && input.dueYmd === undefined) {
    if (extracted?.someday === true) {
      dueAt = null;
      startAt = null;
    } else {
      const smart = input.smartListId;
      if (smart === 'smart:today' || smart === 'smart:upcoming') {
        dueAt = wallIso(todayYmd(zone, now), null, zone);
        isAllDay = true;
      }
    }
  }

  const hasDue = dueAt !== undefined && dueAt !== null;
  let reminderToken = extracted?.reminder;
  if (
    (reminderToken === undefined || reminderToken === 'none') &&
    hasDue &&
    dueHm !== null &&
    input.text.includes('提醒')
  ) {
    reminderToken = 'due';
  }
  const reminder = reminderOf(reminderToken, hasDue);

  const priority: TaskPriority | undefined = input.priority ?? extracted?.priority;

  const draft: CreateTaskInput = {
    title,
    listId,
    timezone: zone,
  };
  if (notes !== undefined && notes !== null && notes !== '') draft.notes = notes;
  if (priority !== undefined) draft.priority = priority;
  if (input.status !== undefined) draft.status = input.status;
  if (dueAt !== undefined) draft.dueAt = dueAt;
  if (startAt !== undefined) draft.startAt = startAt;
  if (isAllDay !== undefined) draft.isAllDay = isAllDay;
  if (reminder.reminderMode !== undefined) draft.reminderMode = reminder.reminderMode;
  if (reminder.reminderOffsetMinutes !== undefined) {
    draft.reminderOffsetMinutes = reminder.reminderOffsetMinutes;
  }
  if (hasDue && repeat.mode === 'rrule') draft.recurrence = repeat.rrule;
  if (hasDue && repeat.mode === 'kind') draft.recurrenceKind = repeat.kind;
  const tagIds = matchTagIds(extracted?.tagNames, ctx.tags);
  if (tagIds !== undefined) draft.tagIds = tagIds;

  return createTaskInputSchema.parse(draft);
}

function weekdayZh(zone: string, now: Date): string {
  return DateTime.fromJSDate(now)
    .setZone(zone)
    .setLocale('zh-CN')
    .toFormat('yyyy-MM-dd cccc HH:mm');
}

function buildPrompt(input: {
  text: string;
  zone: string;
  now: Date;
  lists: List[];
  tags: Tag[];
  smartListId?: string;
}): { system: string; user: string } {
  const lists = input.lists
    .filter((item) => (item.kind === 'inbox' || item.kind === 'user') && !item.isArchived)
    .map((item) => item.name)
    .join('、');
  const tags = input.tags.map((item) => item.name).join('、');
  const system = [
    '你把用户的一句话理解成一条待办任务，只输出 JSON 对象，不要 markdown。',
    '字段：title, notes, priority, dueDate, dueTime, startDate, startTime, isAllDay, someday, reminder, recurrenceKind, recurrenceInterval, listName, tagNames。',
    'title：短标题，去掉日期时间等调度用语。',
    'notes：仅当用户补充了说明、上下文或摘要时填写，否则 null。',
    'priority：0 最高紧急，3 普通。没说紧急程度时用 3。',
    '日期用 YYYY-MM-DD，时间用 HH:mm，按时区计算。没有日期也没有时刻则 dueDate 为 null。',
    '只有时刻、没有日期，而且任务会重复时，dueDate 填今天，dueTime 填该时刻，isAllDay 为 false。不要编造别的日期。',
    '有日期无时刻则 isAllDay true，dueTime null。有时刻则 isAllDay false。',
    'someday：没有日期且用户表达"某天/以后/不着急"时 true，否则 false。',
    'reminder：none / due / 5 / 15 / 30 / 60 / 1440。用户说提醒我并且给了时刻时用 due。有明确时刻的约会但没说提醒时默认 15。全天或没提提醒则 none。',
    'recurrenceKind：daily weekly monthly yearly weekdays weekends holidays legal_workdays，否则 null。',
    'recurrenceInterval：每隔或每间隔 N 个天、周、月、年时填整数 N（1 到 365）。每间隔两个月是 monthly 且 interval 为 2。没说间隔就省略。',
    'listName 必须是给定集合之一，否则 null。tagNames 必须是已有标签，否则 []。',
    '不要编造用户没说的截止日期。',
  ].join('');
  const user = [
    `现在是 ${weekdayZh(input.zone, input.now)}，时区 ${input.zone}。`,
    input.smartListId ? `当前视图 ${input.smartListId}。` : '',
    lists !== '' ? `集合：${lists}。` : '集合：无。',
    tags !== '' ? `标签：${tags}。` : '标签：无。',
    `用户说：${input.text}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
  return { system, user };
}

export async function interpretTaskText(input: {
  text: string;
  user: User;
  timezone: string;
  now: Date;
  lists: List[];
  tags: Tag[];
  smartListId?: string;
}): Promise<ExtractedTask> {
  const prompt = buildPrompt({
    text: input.text,
    zone: input.timezone,
    now: input.now,
    lists: input.lists,
    tags: input.tags,
    ...(input.smartListId !== undefined ? { smartListId: input.smartListId } : {}),
  });
  for (let attempt = 0; ; attempt += 1) {
    let result;
    try {
      result = await completeText(input.user, 'task.parse', {
        systemPrompt: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        json: true,
      });
    } catch (err) {
      if (
        !(err instanceof AppError) ||
        !['LLM_UNAVAILABLE', 'LLM_TIMEOUT', 'LLM_OUTPUT_TRUNCATED'].includes(err.code) ||
        attempt >= 3
      )
        throw err;
      await delay(250 * 2 ** attempt);
      continue;
    }
    if (!result) throw AppError.of(400, 'LLM_NOT_CONFIGURED');
    try {
      const extracted = extractedOf(parseModelJson(result.text));
      logger.info('llm.parse.ok', { model: result.model });
      return extracted;
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'LLM_UNAVAILABLE' || attempt >= 3) throw err;
      await delay(250 * 2 ** attempt);
    }
  }
}
