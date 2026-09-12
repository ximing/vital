import {
  SMART_LIST_IDS,
  type CreateTaskInput,
  type List,
  type RecurrenceKind,
  type Task,
  type TaskPriority,
} from '@vital/dto';
import { t } from '@/copy';

export const UNDO_COMPLETE_MS = 5000;

export type TodoView = 'list' | 'board' | 'week';
export type BoardMode = 'status' | 'priority';
export type TaskNode = { task: Task; children: Task[] };

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isSmartListId(id: string): boolean {
  return (SMART_LIST_IDS as readonly string[]).includes(id);
}

export function inboxList(lists: List[]): List | undefined {
  return lists.find((item) => item.kind === 'inbox');
}

export function userLists(lists: List[]): List[] {
  return lists.filter((item) => item.kind === 'user' && !item.isArchived);
}

function bySort(a: List, b: List): number {
  return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
}

export function listRoots(lists: List[]): List[] {
  return userLists(lists)
    .filter((item) => item.parentId === null)
    .sort(bySort);
}

export function listChildren(lists: List[], parentId: string): List[] {
  return userLists(lists)
    .filter((item) => item.parentId === parentId)
    .sort(bySort);
}

/** `id` plus child ids (depth 2). */
export function descendantListIds(lists: List[], id: string): string[] {
  return [id, ...listChildren(lists, id).map((item) => item.id)];
}

export function countWithDescendants(
  counts: Record<string, number>,
  lists: List[],
  id: string,
): number {
  return descendantListIds(lists, id).reduce((sum, listId) => sum + (counts[listId] ?? 0), 0);
}

export function listPickerRows(lists: List[]): { id: string; name: string; depth: number }[] {
  const rows: { id: string; name: string; depth: number }[] = [];
  for (const root of listRoots(lists)) {
    rows.push({ id: root.id, name: root.name, depth: 0 });
    for (const child of listChildren(lists, root.id)) {
      rows.push({ id: child.id, name: child.name, depth: 1 });
    }
  }
  return rows;
}

export function listTitle(listId: string, lists: List[], fallback: string): string {
  const found = lists.find((item) => item.id === listId);
  return found?.name ?? fallback;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? '';
}

export function formatYmd(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

export function todayYmd(timeZone: string, now = new Date()): string {
  return formatYmd(now, timeZone);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/** Offset of `timeZone` wall time vs UTC at `instant` (east of UTC is positive). */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const asUtc = Date.UTC(
    Number(part(parts, 'year')),
    Number(part(parts, 'month')) - 1,
    Number(part(parts, 'day')),
    Number(part(parts, 'hour')) % 24,
    Number(part(parts, 'minute')),
    Number(part(parts, 'second')),
  );
  return asUtc - instant.getTime();
}

export function zonedWallTimeIso(ymd: string, time: string, timeZone: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(
    year ?? 0,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
    second ?? 0,
  );
  let instant = new Date(wallAsUtc);
  for (let i = 0; i < 3; i += 1) {
    instant = new Date(wallAsUtc - tzOffsetMs(instant, timeZone));
  }
  return instant.toISOString();
}

export function zonedLocalMidnightIso(ymd: string, timeZone: string): string {
  return zonedWallTimeIso(ymd, '00:00:00', timeZone);
}

export function toDateInput(iso: string, timeZone: string): string {
  return formatYmd(new Date(iso), timeZone);
}

export function toDatetimeLocal(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const hour = String(Number(part(parts, 'hour')) % 24).padStart(2, '0');
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}T${hour}:${part(parts, 'minute')}`;
}

export function fromDatetimeLocal(value: string, timeZone: string): string {
  const [ymd, time] = value.split('T');
  if (ymd === undefined || time === undefined) return value;
  const clock = time.length === 5 ? `${time}:00` : time;
  return zonedWallTimeIso(ymd, clock, timeZone);
}

export function isOpen(task: Task): boolean {
  return task.status === 'todo' || task.status === 'doing';
}

export function isOverdue(task: Task, timeZone: string, now = new Date()): boolean {
  if (!isOpen(task) || task.dueAt === null) return false;
  return formatYmd(new Date(task.dueAt), timeZone) < todayYmd(timeZone, now);
}

function reminderFireAt(task: Task): string | null {
  const mode = task.reminderMode ?? 'none';
  if (mode === 'none' || task.dueAt === null) {
    return mode === 'custom' ? task.reminderAt : null;
  }
  if (mode === 'due') return task.dueAt;
  if (mode === 'offset' && task.reminderOffsetMinutes) {
    return new Date(new Date(task.dueAt).getTime() - task.reminderOffsetMinutes * 60_000).toISOString();
  }
  if (mode === 'custom') return task.reminderAt;
  return null;
}

/** All-day due today is due-soon; timed uses reminder fire time <= now < dueAt. */
export function isDueSoon(task: Task, timeZone: string, now = new Date()): boolean {
  if (!isOpen(task)) return false;
  if (task.isAllDay) {
    return (
      task.dueAt !== null && formatYmd(new Date(task.dueAt), timeZone) === todayYmd(timeZone, now)
    );
  }
  const fireAt = reminderFireAt(task);
  if (fireAt === null || task.dueAt === null) return false;
  const ms = now.getTime();
  return new Date(fireAt).getTime() <= ms && ms < new Date(task.dueAt).getTime();
}

export function taskDayYmd(task: Task, timeZone: string): string | null {
  const instant = task.dueAt ?? task.startAt;
  if (instant === null) return null;
  return formatYmd(new Date(instant), timeZone);
}

export function weekdayInZone(ymd: string, timeZone: string): number {
  const instant = new Date(zonedLocalMidnightIso(ymd, timeZone));
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  return WEEKDAY_SHORT[short] ?? 0;
}

export function startOfWeekYmd(ymd: string, weekStartsOn: 0 | 1, timeZone: string): string {
  const dow = weekdayInZone(ymd, timeZone);
  const delta = (dow - weekStartsOn + 7) % 7;
  return addDaysYmd(ymd, -delta);
}

export function weekYmids(anchorYmd: string, weekStartsOn: 0 | 1, timeZone: string): string[] {
  const start = startOfWeekYmd(anchorYmd, weekStartsOn, timeZone);
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
}

export function weekRangeIso(
  anchorYmd: string,
  weekStartsOn: 0 | 1,
  timeZone: string,
): { from: string; to: string; days: string[] } {
  const days = weekYmids(anchorYmd, weekStartsOn, timeZone);
  const start = days[0] ?? anchorYmd;
  const endExclusive = addDaysYmd(start, 7);
  const from = zonedLocalMidnightIso(start, timeZone);
  const to = new Date(
    new Date(zonedLocalMidnightIso(endExclusive, timeZone)).getTime() - 1,
  ).toISOString();
  return { from, to, days };
}

export function nestTasks(tasks: Task[]): TaskNode[] {
  const ids = new Set(tasks.map((item) => item.id));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  for (const task of sorted) {
    if (task.parentId && ids.has(task.parentId)) {
      const list = children.get(task.parentId) ?? [];
      list.push(task);
      children.set(task.parentId, list);
    } else {
      roots.push(task);
    }
  }
  return roots.map((task) => ({ task, children: children.get(task.id) ?? [] }));
}

export function flattenNodes(nodes: TaskNode[]): { task: Task; depth: 0 | 1 }[] {
  const out: { task: Task; depth: 0 | 1 }[] = [];
  for (const node of nodes) {
    out.push({ task: node.task, depth: 0 });
    for (const child of node.children) out.push({ task: child, depth: 1 });
  }
  return out;
}

export function matchesQuery(task: Task, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  return task.title.toLowerCase().includes(needle) || task.notes.toLowerCase().includes(needle);
}

export function filterTasks(tasks: Task[], q: string): Task[] {
  const needle = q.trim().toLowerCase();
  if (needle === '') return tasks;
  const direct = new Set(tasks.filter((task) => matchesQuery(task, needle)).map((task) => task.id));
  const keep = new Set<string>();
  for (const task of tasks) {
    if (direct.has(task.id)) {
      keep.add(task.id);
      if (task.parentId) keep.add(task.parentId);
    }
  }
  for (const task of tasks) {
    if (task.parentId && direct.has(task.parentId)) keep.add(task.id);
  }
  return tasks.filter((task) => keep.has(task.id));
}

export function partitionToday(
  nodes: TaskNode[],
  timeZone: string,
  now = new Date(),
): { overdue: TaskNode[]; today: TaskNode[] } {
  const overdue: TaskNode[] = [];
  const today: TaskNode[] = [];
  for (const node of nodes) {
    if (isOverdue(node.task, timeZone, now)) overdue.push(node);
    else today.push(node);
  }
  return { overdue, today };
}

export function groupByDay(
  nodes: TaskNode[],
  timeZone: string,
): { ymd: string; nodes: TaskNode[] }[] {
  const buckets = new Map<string, TaskNode[]>();
  for (const node of nodes) {
    const ymd = taskDayYmd(node.task, timeZone);
    if (ymd === null) continue;
    const list = buckets.get(ymd) ?? [];
    list.push(node);
    buckets.set(ymd, list);
  }
  const keys = [...buckets.keys()].sort();
  return keys.map((ymd) => ({ ymd, nodes: buckets.get(ymd) ?? [] }));
}

/** Same grouping ListView paints — j/k must walk this order, not raw sortOrder. */
export type ListSection = {
  key: string;
  heading: 'pinned' | 'overdue' | 'today' | 'done' | 'day' | 'list' | null;
  ymd?: string;
  listName?: string;
  nodes: TaskNode[];
};

function isPinnedRoot(task: Task): boolean {
  return task.pinned && task.parentId === null;
}

function splitPinned(tasks: Task[]): { pinned: Task[]; rest: Task[] } {
  const pinnedIds = new Set(tasks.filter(isPinnedRoot).map((task) => task.id));
  const inPinnedTree = (task: Task) =>
    isPinnedRoot(task) || (task.parentId !== null && pinnedIds.has(task.parentId));
  return {
    pinned: tasks.filter(inPinnedTree),
    rest: tasks.filter((task) => !inPinnedTree(task)),
  };
}

export function pinnedFirst<T extends { pinned?: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}

function nestPinnedFirst(tasks: Task[]): TaskNode[] {
  const { pinned, rest } = splitPinned(tasks);
  return [...nestTasks(pinned), ...nestTasks(rest)];
}

export function listSections(
  listId: string,
  tasks: Task[],
  timeZone: string,
  now = new Date(),
  lists: List[] = [],
): ListSection[] {
  const open = tasks.filter((task) => task.status !== 'done' && task.status !== 'canceled');
  const done = tasks.filter((task) => task.status === 'done');
  const { pinned: pinnedOpen, rest: restOpen } = splitPinned(open);
  const pinnedNodes = nestTasks(pinnedOpen);
  const openNodes = nestTasks(restOpen);
  const doneNodes = nestPinnedFirst(done);
  const nonempty = (sections: ListSection[]): ListSection[] =>
    sections.filter((section) => section.nodes.length > 0);
  const pinnedSection: ListSection = { key: 'pinned', heading: 'pinned', nodes: pinnedNodes };

  if (listId === 'smart:today') {
    const { overdue, today } = partitionToday(openNodes, timeZone, now);
    return nonempty([
      pinnedSection,
      { key: 'overdue', heading: 'overdue', nodes: overdue },
      { key: 'today', heading: 'today', nodes: today },
    ]);
  }
  if (listId === 'smart:upcoming') {
    return nonempty([
      pinnedSection,
      ...groupByDay(openNodes, timeZone).map((group) => ({
        key: group.ymd,
        heading: 'day' as const,
        ymd: group.ymd,
        nodes: group.nodes,
      })),
    ]);
  }
  if (listId === 'smart:done') {
    const { pinned: pinnedDone, rest: restDone } = splitPinned(done);
    return nonempty([
      { key: 'pinned', heading: 'pinned', nodes: nestTasks(pinnedDone) },
      { key: 'done', heading: null, nodes: nestTasks(restDone) },
    ]);
  }
  if (listId.startsWith('smart:')) {
    return nonempty([pinnedSection, { key: 'open', heading: null, nodes: openNodes }]);
  }
  const children = listChildren(lists, listId);
  if (children.length > 0) {
    const openOf = (id: string) =>
      nestTasks(restOpen.filter((task) => task.listId === id));
    return nonempty([
      pinnedSection,
      { key: 'own', heading: 'list', listName: t.todos.thisList, nodes: openOf(listId) },
      ...children.map((child) => ({
        key: child.id,
        heading: 'list' as const,
        listName: child.name,
        nodes: openOf(child.id),
      })),
      { key: 'done', heading: 'done', nodes: doneNodes },
    ]);
  }
  return nonempty([
    pinnedSection,
    { key: 'open', heading: null, nodes: nestTasks(restOpen) },
    { key: 'done', heading: 'done', nodes: doneNodes },
  ]);
}

export function listVisibleIds(
  listId: string,
  tasks: Task[],
  timeZone: string,
  now = new Date(),
  lists: List[] = [],
): string[] {
  return listSections(listId, tasks, timeZone, now, lists).flatMap((section) =>
    flattenNodes(section.nodes).map((row) => row.task.id),
  );
}

export function boardVisibleIds(tasks: Task[], mode: BoardMode): string[] {
  if (mode === 'status') {
    const by = splitByStatus(tasks);
    return [...by.todo, ...by.doing, ...by.done].map((task) => task.id);
  }
  const by = splitByPriority(tasks);
  return [...by[0], ...by[1], ...by[2], ...by[3]].map((task) => task.id);
}

export function splitByStatus(tasks: Task[]): Record<'todo' | 'doing' | 'done', Task[]> {
  return {
    todo: pinnedFirst(tasks.filter((task) => task.status === 'todo')),
    doing: pinnedFirst(tasks.filter((task) => task.status === 'doing')),
    done: pinnedFirst(tasks.filter((task) => task.status === 'done')),
  };
}

export function splitByPriority(tasks: Task[]): Record<TaskPriority, Task[]> {
  return {
    0: pinnedFirst(tasks.filter((task) => task.priority === 0)),
    1: pinnedFirst(tasks.filter((task) => task.priority === 1)),
    2: pinnedFirst(tasks.filter((task) => task.priority === 2)),
    3: pinnedFirst(tasks.filter((task) => task.priority === 3)),
  };
}

export function writeListId(listId: string, inboxId: string): string {
  return isSmartListId(listId) ? inboxId : listId;
}

export function createPayload(
  title: string,
  listId: string,
  inboxId: string,
  timeZone: string,
  now = new Date(),
  dueYmd?: string,
): CreateTaskInput {
  const trimmed = title.trim();
  const target = writeListId(listId, inboxId);
  if (dueYmd) {
    return {
      title: trimmed,
      listId: target,
      dueAt: zonedLocalMidnightIso(dueYmd, timeZone),
      isAllDay: true,
      timezone: timeZone,
    };
  }
  const today = todayYmd(timeZone, now);
  const midnight = zonedLocalMidnightIso(today, timeZone);
  if (listId === 'smart:today' || listId === 'smart:upcoming') {
    return { title: trimmed, listId: target, dueAt: midnight, isAllDay: true, timezone: timeZone };
  }
  if (listId === 'smart:someday') {
    return { title: trimmed, listId: target, dueAt: null, startAt: null, timezone: timeZone };
  }
  return { title: trimmed, listId: target, timezone: timeZone };
}

export function emptyCopyKey(
  listId: string,
): 'today' | 'inboxList' | 'upcoming' | 'done' | 'userList' {
  if (listId === 'smart:today') return 'today';
  if (listId === 'smart:inbox') return 'inboxList';
  if (listId === 'smart:done') return 'done';
  if (listId === 'smart:upcoming' || listId === 'smart:someday') {
    return 'upcoming';
  }
  return 'userList';
}

export function priorityLabel(priority: TaskPriority): 'p0' | 'p1' | 'p2' | 'p3' {
  if (priority === 0) return 'p0';
  if (priority === 1) return 'p1';
  if (priority === 2) return 'p2';
  return 'p3';
}

export function priorityTone(priority: TaskPriority): string {
  if (priority === 0) return 'text-overdue';
  if (priority === 1) return 'text-due';
  if (priority === 2) return 'text-doing';
  return 'text-muted';
}

export function orderedAfterDrop(
  ids: string[],
  draggedId: string,
  targetId: string,
  place: 'before' | 'after',
): string[] {
  if (draggedId === targetId) return ids;
  const next = ids.filter((id) => id !== draggedId);
  const idx = next.indexOf(targetId);
  if (idx < 0) return ids;
  next.splice(place === 'before' ? idx : idx + 1, 0, draggedId);
  return next;
}

export function siblingIds(tasks: Task[], listId: string, parentId: string | null): string[] {
  return tasks
    .filter((task) => task.listId === listId && task.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((task) => task.id);
}

export function formatHm(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = String(Number(part(parts, 'hour')) % 24).padStart(2, '0');
  return `${hour}:${part(parts, 'minute')}`;
}

/** Next dueAt if this overdue task is pushed to `today` (keeps time-of-day). */
export function overdueDueAtForToday(task: Task, today: string, timeZone: string): string | null {
  if (task.dueAt === null || task.status === 'done' || task.status === 'canceled') return null;
  return task.isAllDay
    ? zonedLocalMidnightIso(today, timeZone)
    : fromDatetimeLocal(`${today}T${formatHm(task.dueAt, timeZone)}`, timeZone);
}

export function formatHumanDay(ymd: string, timeZone: string, now = new Date()): string {
  if (ymd === '') return '';
  const today = todayYmd(timeZone, now);
  if (ymd === today) return '今天';
  if (ymd === addDaysYmd(today, 1)) return '明天';
  if (ymd === addDaysYmd(today, -1)) return '昨天';
  const [year, month, day] = ymd.split('-').map(Number);
  if (String(year) === today.slice(0, 4)) return `${month}月${day}日`;
  return `${year}年${month}月${day}日`;
}

export function dueMeta(task: Task, timeZone: string, now = new Date()): string | null {
  if (task.dueAt === null && task.startAt === null) return null;
  const ymd = taskDayYmd(task, timeZone);
  if (ymd === null) return null;
  const day = formatHumanDay(ymd, timeZone, now);
  if (task.isAllDay) return day;
  const clock = formatHm(task.dueAt ?? task.startAt ?? '', timeZone);
  return `${day} ${clock}`;
}

export function recurrenceMeta(task: Task): string | null {
  const kind: RecurrenceKind | 'none' | 'custom' = task.recurrenceKind ?? recurrenceKind(task.recurrence);
  if (kind === 'none') return null;
  if (kind === 'daily') return t.todos.recurrenceDaily;
  if (kind === 'weekly') return t.todos.recurrenceWeekly;
  if (kind === 'monthly') return t.todos.recurrenceMonthly;
  if (kind === 'yearly') return t.todos.recurrenceYearly;
  if (kind === 'weekdays') return t.todos.recurrenceWeekdays;
  if (kind === 'weekends') return t.todos.recurrenceWeekends;
  if (kind === 'holidays') return t.todos.recurrenceHolidays;
  if (kind === 'legal_workdays') return t.todos.recurrenceLegalWorkdays;
  return t.todos.recurrence;
}

export function reminderMeta(task: Task, timeZone: string): string | null {
  const mode = task.reminderMode ?? 'none';
  if (mode === 'none') return null;
  if (mode === 'due') return t.todos.reminderDue;
  if (mode === 'offset') {
    const minutes = task.reminderOffsetMinutes ?? 15;
    if (minutes === 5) return t.todos.reminder5m;
    if (minutes === 15) return t.todos.reminder15m;
    if (minutes === 30) return t.todos.reminder30m;
    if (minutes === 60) return t.todos.reminder1h;
    if (minutes === 1440) return t.todos.reminder1d;
  }
  if (task.reminderAt) return `${t.todos.remind} ${formatHm(task.reminderAt, timeZone)}`;
  return t.todos.remind;
}

export function recurrenceKind(
  rrule: string | null,
): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' {
  if (rrule === null || rrule === '') return 'none';
  if (/\bFREQ=DAILY\b/.test(rrule) && !/\bBYDAY=/.test(rrule)) return 'daily';
  if (/\bFREQ=WEEKLY\b/.test(rrule) && !/\bBYDAY=/.test(rrule)) return 'weekly';
  if (/\bFREQ=MONTHLY\b/.test(rrule)) return 'monthly';
  if (/\bFREQ=YEARLY\b/.test(rrule)) return 'yearly';
  return 'custom';
}

export function rruleForKind(kind: 'daily' | 'weekly' | 'monthly' | 'yearly'): string {
  if (kind === 'daily') return 'FREQ=DAILY';
  if (kind === 'weekly') return 'FREQ=WEEKLY';
  if (kind === 'monthly') return 'FREQ=MONTHLY';
  return 'FREQ=YEARLY';
}

export function applyOptimisticComplete(
  tasks: Task[],
  completingIds: ReadonlySet<string>,
  showId: string | null,
): Task[] {
  return tasks.filter((task) => !completingIds.has(task.id) || task.id === showId);
}
