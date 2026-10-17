import { z } from 'zod';

/** Display slots the Today page can render. The agent chooses order and membership. */
export const TODAY_MODULE_IDS = [
  'note',
  'lead',
  'weather',
  'meetings',
  'upcoming',
  'holiday',
  'focus',
] as const;
export type TodayModuleId = (typeof TODAY_MODULE_IDS)[number];

export interface TodayLayoutModule {
  id: TodayModuleId;
  /** The agent's own sentence. Only `note` keeps it. */
  text?: string;
}

export interface TodayLayout {
  modules: TodayLayoutModule[];
  updatedAt: string;
}

/** Used only until an agent layout exists. Not the composition rule. */
export const FALLBACK_TODAY_MODULES: readonly TodayLayoutModule[] = [
  { id: 'lead' },
  { id: 'weather' },
  { id: 'meetings' },
  { id: 'upcoming' },
  { id: 'holiday' },
  { id: 'focus' },
];

const NOTE_MAX = 80;

function isModuleId(value: string): value is TodayModuleId {
  return (TODAY_MODULE_IDS as readonly string[]).includes(value);
}

/** Drop unknown ids, duplicates, and a note that has no sentence. */
export function normalizeTodayLayout(input: unknown): TodayLayoutModule[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const modules: TodayLayoutModule[] = [];
  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string' || !isModuleId(id) || seen.has(id)) continue;
    if (id === 'note') {
      const text = (item as { text?: unknown }).text;
      if (typeof text !== 'string') continue;
      const trimmed = text.trim().slice(0, NOTE_MAX);
      if (trimmed === '') continue;
      seen.add(id);
      modules.push({ id, text: trimmed });
      continue;
    }
    seen.add(id);
    modules.push({ id });
  }
  return modules;
}

export function todayModulesOrFallback(layout: TodayLayout | null | undefined): TodayLayoutModule[] {
  if (!layout || layout.modules.length === 0) return [...FALLBACK_TODAY_MODULES];
  return layout.modules;
}

export interface TodayLayoutFacts {
  timezone: string;
  localNow: string;
  openTasks: {
    title: string;
    due: string | null;
    overdue: boolean;
    priority?: 0 | 1 | 2 | 3;
    /** Confirmed agent time-box. Focus should show these first. */
    timeboxed?: boolean;
  }[];
  upcoming: { title: string; when: string }[];
  holidayName: string;
  holidayDate: string;
  weather: string;
  meetings: string;
  recommendations: string[];
  quiet: boolean;
  habits: string[];
  memory: string[];
  /** Rhythm profile sentence. Omitted when the user has no profile. */
  rhythm?: string;
}

/** Facts the layout agent is allowed to see. It must not be asked to invent the rest. */
export function describeTodayLayoutFacts(facts: TodayLayoutFacts): string {
  const tasks = facts.openTasks.length === 0
    ? '无'
    : facts.openTasks
        .map((task) => {
          const rank = task.priority === 0 ? '紧急' : task.priority === 1 ? '高' : task.priority === 2 ? '中' : '';
          return `${task.title}${rank ? `（${rank}）` : ''}${task.overdue ? '（已逾期）' : ''}${task.due ? ` 截止 ${task.due}` : ''}`;
        })
        .join('；');
  const upcoming = facts.upcoming.length === 0
    ? '无'
    : facts.upcoming.map((item) => `${item.title} ${item.when}`).join('；');
  const habits = facts.habits.length === 0 ? '无' : facts.habits.join('；');
  const picks = facts.recommendations.length === 0 ? '无' : facts.recommendations.join('；');
  const memory = facts.memory.length === 0 ? '无' : facts.memory.join('；');
  const timeboxed = facts.openTasks.filter((task) => task.timeboxed).map((task) => task.title);
  return [
    `时区 ${facts.timezone}，当地时间 ${facts.localNow}${facts.quiet ? '，现在是安静时段' : ''}`,
    `今天未完成：${tasks}`,
    `已排时间盒：${timeboxed.length === 0 ? '无' : timeboxed.join('、')}`,
    `今天之后七天内：${upcoming}`,
    `最近节假日：${facts.holidayName} ${facts.holidayDate}`,
    `天气：${facts.weather}`,
    `日程：${facts.meetings}`,
    `习惯：${habits}`,
    `建议开始的候选：${picks}`,
    `长期偏好：${memory}`,
    ...(facts.rhythm ? [`节奏画像：${facts.rhythm}`] : []),
  ].join('\n');
}

export const todayLayoutContextSchema = z.object({
  weather: z
    .object({
      status: z.enum(['ready', 'unavailable']),
      place: z.string().max(80).optional(),
      condition: z.string().max(20).optional(),
      temperatureC: z.number().finite().optional(),
      clothing: z.string().max(40).optional(),
    })
    .nullable(),
  meetings: z
    .object({
      status: z.enum(['mac-only', 'denied', 'failed', 'events']),
      events: z
        .array(
          z.object({
            title: z.string().max(120),
            start: z.string().max(40),
            allDay: z.boolean(),
          }),
        )
        .max(20)
        .optional(),
    })
    .nullable(),
});
export type TodayLayoutContext = z.infer<typeof todayLayoutContextSchema>;
