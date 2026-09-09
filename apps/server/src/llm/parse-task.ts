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

const extractedSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  notes: z.string().max(50_000).nullable().optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: z.string().nullable().optional(),
  dueTime: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  isAllDay: z.boolean().optional(),
  someday: z.boolean().optional(),
  reminder: z.enum(['none', 'due', '5', '15', '30', '60', '1440']).optional(),
  recurrenceKind: recurrenceKindSchema.nullable().optional(),
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

  const dueYmd = extracted?.dueDate ?? input.dueYmd ?? null;
  const dueHm = extracted?.dueTime ?? null;
  const startYmd = extracted?.startDate ?? null;
  const startHm = extracted?.startTime ?? null;

  let dueAt: string | null | undefined;
  let startAt: string | null | undefined;
  let isAllDay: boolean | undefined;

  if (dueYmd) {
    const timed = dueHm !== null;
    isAllDay = extracted?.isAllDay ?? !timed;
    dueAt = wallIso(dueYmd, isAllDay ? null : dueHm, zone);
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
  const reminder = reminderOf(extracted?.reminder, hasDue);
  let recurrenceKind: RecurrenceKind | null | undefined = extracted?.recurrenceKind;
  if (recurrenceKind && !hasDue) recurrenceKind = null;

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
  if (recurrenceKind !== undefined) draft.recurrenceKind = recurrenceKind;
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
    '字段：title, notes, priority, dueDate, dueTime, startDate, startTime, isAllDay, someday, reminder, recurrenceKind, listName, tagNames。',
    'title：短标题，去掉日期时间等调度用语。',
    'notes：仅当用户补充了说明、上下文或摘要时填写，否则 null。',
    'priority：0 最高紧急，3 普通。没说紧急程度时用 3。',
    '日期用 YYYY-MM-DD，时间用 HH:mm，相对今天的时区计算。没有日期则 dueDate 为 null。',
    '有日期无时刻则 isAllDay true，dueTime null。有时刻则 isAllDay false。',
    'someday：没有日期且用户表达"某天/以后/不着急"时 true，否则 false。',
    'reminder：none / due / 5 / 15 / 30 / 60 / 1440。有明确时刻的约会默认 15；全天任务默认 none；没提提醒则 none。',
    'recurrenceKind：daily weekly monthly yearly weekdays weekends holidays legal_workdays，否则 null。',
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
  const result = await completeText(input.user, 'task.parse', {
    systemPrompt: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    json: true,
  });
  if (!result) throw AppError.of(400, 'LLM_NOT_CONFIGURED');
  const extracted = extractedOf(parseModelJson(result.text));
  logger.info('llm.parse.ok', { model: result.model });
  return extracted;
}
