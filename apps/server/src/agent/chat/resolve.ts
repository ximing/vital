import type { Task } from '@vital/dto';
import { AppError } from '../../errors.js';
import { listLists } from '../../lists/lists.service.js';
import { listTags } from '../../tags/tags.service.js';
import { getTask, listTasks } from '../../tasks/tasks.read.js';
import { needsInput, toolError, type ToolCtx, type ToolResult } from './types.js';

export function normName(value: string): string {
  return value.trim();
}

export function pageListId(ctx: ToolCtx): string | null {
  if (ctx.page.listId) return ctx.page.listId;
  if (ctx.page.section === 'today') return 'smart:today';
  if (ctx.page.section === 'capture') return 'smart:inbox';
  return null;
}

export async function firstPage(ctx: ToolCtx): Promise<{ tasks: Task[]; limited: boolean } | null> {
  const listId = pageListId(ctx);
  if (!listId) return null;
  const page = await listTasks(ctx.userId, { listId, limit: 20 });
  return { tasks: page.items, limited: page.nextCursor !== null };
}

async function loadTask(userId: string, id: string): Promise<Task | ToolResult> {
  try {
    return await getTask(userId, id);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return toolError('TASK_NOT_FOUND', '没有找到这条待办。');
    throw err;
  }
}

export async function resolveTask(
  ctx: ToolCtx,
  input: { taskId?: string; title?: string; matchTitle?: string },
  opts: { includeHabits: boolean },
): Promise<{ task: Task } | ToolResult> {
  if (input.taskId) {
    const task = await loadTask(ctx.userId, input.taskId);
    if (isToolResult(task)) return task;
    return { task };
  }
  const title = normName(input.title ?? input.matchTitle ?? '');
  if (!title) return needsInput('要说清是哪一条待办。');

  const visible = ctx.page.visibleTaskIds;
  let pool: Task[] = [];
  let limited = false;
  if (visible.length > 0) {
    const page = await firstPage(ctx);
    const byId = new Map((page?.tasks ?? []).map((task) => [task.id, task]));
    const owned: Task[] = [];
    for (const id of visible) {
      const cached = byId.get(id);
      const task = cached ?? (await loadTask(ctx.userId, id));
      if (isToolResult(task)) return task;
      if (task.habitId && !opts.includeHabits) continue;
      owned.push(task);
    }
    pool = owned;
    if (opts.includeHabits && page) {
      for (const task of page.tasks) {
        if (task.habitId && !pool.some((item) => item.id === task.id)) pool.push(task);
      }
      limited = page.limited;
    }
  } else {
    const page = await firstPage(ctx);
    if (!page) return needsInput('先打开要改的列表，或直接说出任务全名。');
    pool = opts.includeHabits ? page.tasks : page.tasks.filter((task) => task.habitId === null);
    limited = page.limited;
  }
  const hits = pool.filter((task) => normName(task.title) === title);
  if (hits.length === 0) {
    return needsInput(limited ? `没有在当前列表第一页找到「${title}」。` : `没有找到「${title}」。`);
  }
  if (hits.length > 1) return needsInput(`有 ${String(hits.length)} 条都叫「${title}」，请点开其中一条再试。`);
  const hit = hits[0];
  if (!hit) return needsInput('没有找到这条待办。');
  return { task: hit };
}

export async function resolveListId(userId: string, name: string): Promise<{ id: string } | ToolResult> {
  const lists = await listLists(userId);
  const hits = lists.items.filter((list) => !list.id.startsWith('smart:') && normName(list.name) === normName(name));
  if (hits.length === 0) return needsInput(`没有叫「${name}」的清单。`);
  if (hits.length > 1) return needsInput(`有多个清单叫「${name}」。`);
  const hit = hits[0];
  if (!hit) return needsInput(`没有叫「${name}」的清单。`);
  return { id: hit.id };
}

export async function resolveTagIds(userId: string, names: string[]): Promise<{ ids: string[] } | ToolResult> {
  const tags = await listTags(userId);
  const ids: string[] = [];
  for (const name of names) {
    const hits = tags.items.filter((tag) => normName(tag.name) === normName(name));
    if (hits.length === 0) return needsInput(`没有叫「${name}」的标签。`);
    if (hits.length > 1) return needsInput(`有多个标签叫「${name}」。`);
    const hit = hits[0];
    if (!hit) return needsInput(`没有叫「${name}」的标签。`);
    ids.push(hit.id);
  }
  return { ids };
}

export function isToolResult(value: object): value is ToolResult {
  if (!('status' in value)) return false;
  const status = value.status;
  return status === 'ok' || status === 'preview' || status === 'needs_input' || status === 'error';
}
