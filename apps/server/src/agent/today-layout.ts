import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import {
  describeTodayLayoutFacts,
  nearestStatutoryHoliday,
  normalizeTodayLayout,
  upcomingExcludingToday,
  type TodayLayout,
  type TodayLayoutContext,
  type TodayLayoutFacts,
} from '@vital/dto';
import { getDb } from '../db/index.js';
import { habits, todayLayouts, users, type User } from '../db/schema.js';
import { isOverdue } from '../outcomes/rule-engine.js';
import { listTasks } from '../tasks/tasks.read.js';
import { executionResult } from './executions.service.js';
import { loadAgentMemory, runProposalPass } from './harness.js';
import { enqueueTodayLayout } from './jobs.js';
import { loadRhythmProfileSafe } from './rhythm-distill.js';
import { orderModulesForRhythm, rhythmPromptLine } from './rhythm-profile.js';
import { submitTodayLayoutTool } from './tools.js';

const SYSTEM_PROMPT = `你负责「今天」页的模块排布。页面只能渲染下面这些模块，顺序就是视觉顺序，靠前的更显眼。
你要自己判断哪些值得占地方。不要把所有模块都堆上去，也不要发明新模块。
不得编造任务、天气、日程或节假日；材料里没有的事实不要写进 note。
- note：只写材料推不出来的判断，text 必填，80 字以内。页面已经给出逾期、紧急、高、中的数量，并列出该先做的几件。不要再列任务名，也不要重复这些数量。没有这种判断就不要放 note。
- lead：今天该先做的事。页面自己统计逾期和优先级，只展开已逾期或标了紧急、高、中的几件。有未完成事项时通常留下。
- weather：天气和穿衣。没有预报时，这个模块会请用户填城市。
- meetings：今天的本地日历，包含会议和其他日程。Mac 桌面读 Mac 日历，手机读手机日历。没有权限时必须留下。Mac 由应用向系统申请，申请后系统日历列表里才会出现 Vital；手机打开本应用的系统设置。材料写明只在 Mac 桌面版时，网页上会显示这句话。
- upcoming：今天之后七天内的安排。没有时可以不放。
- holiday：最近的法定节假日。离得很远、又帮不上今天的安排时可以不放。
- focus：建议开始的候选。已排时间盒的任务优先。没有候选或现在是安静时段时可以不放。
必须调用 submit_today_layout。`;

function weatherSentence(context: Record<string, unknown>): string {
  const weather = context['weather'];
  if (typeof weather !== 'object' || weather === null) return '还没有上报';
  const row = weather as { status?: unknown; place?: unknown; condition?: unknown; temperatureC?: unknown; clothing?: unknown };
  if (row.status === 'unavailable') return '暂不可用，用户可以自己填城市';
  if (row.status !== 'ready') return '还没有上报';
  const place = typeof row.place === 'string' ? row.place : '';
  const condition = typeof row.condition === 'string' ? row.condition : '';
  const temp = typeof row.temperatureC === 'number' ? `${String(Math.round(row.temperatureC))}°C` : '';
  const clothing = typeof row.clothing === 'string' ? row.clothing : '';
  return [place, condition, temp, clothing].filter((part) => part !== '').join(' ') || '还没有上报';
}

function meetingsSentence(context: Record<string, unknown>): string {
  const meetings = context['meetings'];
  if (typeof meetings !== 'object' || meetings === null) return '还没有上报';
  const row = meetings as { status?: unknown; events?: unknown };
  if (row.status === 'mac-only') return '本地日历只在 Mac 桌面版';
  if (row.status === 'denied') return '需要日历权限，页面会由 Vital 向系统申请';
  if (row.status === 'failed') return '日历暂时读不到';
  if (row.status !== 'events' || !Array.isArray(row.events) || row.events.length === 0) return '今天没有日程';
  return row.events
    .flatMap((event) => {
      if (typeof event !== 'object' || event === null) return [];
      const item = event as { title?: unknown; start?: unknown; allDay?: unknown };
      if (typeof item.title !== 'string') return [];
      const when = item.allDay === true ? '全天' : typeof item.start === 'string' ? item.start : '';
      return [`${item.title}${when ? ` ${when}` : ''}`];
    })
    .join('；') || '今天没有日程';
}

function inQuiet(now: Date, timeZone: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const hm = DateTime.fromJSDate(now).setZone(timeZone).toFormat('HH:mm');
  if (start <= end) return hm >= start && hm < end;
  return hm >= start || hm < end;
}

async function loadFacts(user: User, now: Date): Promise<TodayLayoutFacts> {
  const [today, upcoming, habitRows, layoutRow] = await Promise.all([
    listTasks(user.id, { listId: 'smart:today', limit: 40 }),
    listTasks(user.id, { listId: 'smart:upcoming', limit: 40 }),
    getDb()
      .select({ name: habits.name })
      .from(habits)
      .where(and(eq(habits.userId, user.id), eq(habits.active, true)))
      .limit(12),
    getDb().select().from(todayLayouts).where(eq(todayLayouts.userId, user.id)).limit(1),
  ]);
  const zone = user.timezone;
  const zoned = DateTime.fromJSDate(now).setZone(zone);
  const open = today.items.filter((task) => task.habitId === null && task.status !== 'done' && task.status !== 'canceled');
  const timeboxedFirst = (task: { agentScheduled?: boolean; startAt: string | null; isAllDay: boolean }) =>
    task.agentScheduled === true && task.startAt !== null && !task.isAllDay;
  const later = upcomingExcludingToday(upcoming.items, zoned.toISODate() ?? '', zone);
  const holiday = nearestStatutoryHoliday(zoned.toISODate() ?? '');
  const context = layoutRow[0]?.context ?? {};
  return {
    timezone: zone,
    localNow: zoned.toFormat('yyyy-MM-dd HH:mm cccc'),
    openTasks: open.map((task) => ({
      title: task.title,
      due: task.dueAt,
      overdue: task.dueAt !== null && isOverdue(new Date(task.dueAt), task.isAllDay, now, zone),
      priority: task.priority,
      ...(timeboxedFirst(task) ? { timeboxed: true } : {}),
    })),
    upcoming: later.map((task) => ({
      title: task.title,
      when: task.dueAt ?? task.startAt ?? '',
    })),
    holidayName: holiday.name,
    holidayDate: holiday.date,
    weather: weatherSentence(context),
    meetings: meetingsSentence(context),
    recommendations: [...open]
      .sort((a, b) => Number(timeboxedFirst(b)) - Number(timeboxedFirst(a)))
      .slice(0, 4)
      .map((task) => task.title),
    quiet: inQuiet(now, zone, user.quietHoursStart, user.quietHoursEnd),
    habits: habitRows.map((row) => row.name),
    memory: [],
  };
}

export async function readTodayLayout(userId: string): Promise<TodayLayout | null> {
  const [row] = await getDb().select().from(todayLayouts).where(eq(todayLayouts.userId, userId)).limit(1);
  if (!row) return null;
  const modules = normalizeTodayLayout(row.modules);
  if (modules.length === 0) return null;
  return { modules, updatedAt: row.updatedAt.toISOString() };
}

export async function saveTodayLayoutContext(userId: string, context: TodayLayoutContext, now = new Date()): Promise<void> {
  // Morning brief treats this stamp as "today page was open". Layout rewrites must not clear context.
  const stored: Record<string, unknown> = { ...context, reportedAt: now.toISOString() };
  await getDb()
    .insert(todayLayouts)
    .values({ userId, modules: [], context: stored, updatedAt: now })
    .onConflictDoUpdate({
      target: todayLayouts.userId,
      set: { context: stored, updatedAt: now },
    });
  // Opening Today is itself a reason to compose, even when no task changed this week.
  // The slot key makes repeats inside the same three hours a no-op.
  const [owner] = await getDb()
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!owner) return;
  const zoned = DateTime.fromJSDate(now).setZone(owner.timezone);
  const layoutHour = Math.floor(zoned.hour / 3) * 3;
  await enqueueTodayLayout(
    getDb(),
    userId,
    now,
    'schedule',
    `${zoned.toFormat('yyyyLLdd')}${String(layoutHour).padStart(2, '0')}`,
  );
}

export async function processTodayLayout(user: User, now: Date): Promise<'done'> {
  const facts = await loadFacts(user, now);
  const profile = await loadRhythmProfileSafe(user.id);
  const rhythm = rhythmPromptLine(profile);
  const memory = await loadAgentMemory(user.id, 'all', facts.openTasks.map((task) => task.title).join(' '));
  const result = await runProposalPass({
    user,
    capability: 'default',
    systemPrompt: rhythm
      ? `${SYSTEM_PROMPT}\n若材料有节奏画像：当前时刻落在高效时段时，把 focus 放在 lead 后面、其余模块前面；低效星期且不在高效时段时，不要把 focus 放在最前。不要把画像写成任务或写进 note。`
      : SYSTEM_PROMPT,
    userPrompt: describeTodayLayoutFacts({
      ...facts,
      memory: memory.map((item) => item.content),
      ...(rhythm ? { rhythm } : {}),
    }),
    makeTool: submitTodayLayoutTool,
  });
  if (!result) {
    executionResult({ resultSummary: '没有可用模型，沿用现有排布', inputSummary: '今天页模块' });
    return 'done';
  }
  const proposed = normalizeTodayLayout(result.args.modules);
  if (proposed.length === 0) {
    executionResult({ resultSummary: '提案没有可展示的模块，沿用现有排布', inputSummary: '今天页模块' });
    return 'done';
  }
  const zoned = DateTime.fromJSDate(now).setZone(user.timezone);
  const modules = zoned.isValid
    ? orderModulesForRhythm(proposed, { weekday: zoned.weekday, minutes: zoned.hour * 60 + zoned.minute }, profile)
    : proposed;
  await getDb()
    .insert(todayLayouts)
    .values({ userId: user.id, modules, context: {}, updatedAt: now })
    .onConflictDoUpdate({
      target: todayLayouts.userId,
      set: { modules, updatedAt: now },
    });
  executionResult({
    resultSummary: `排布 ${modules.map((item) => item.id).join('、')}`,
    inputSummary: `今天 ${String(facts.openTasks.length)} 件未完成`,
  });
  return 'done';
}
