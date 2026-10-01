import { SMART_LIST_IDS, type ChatUndoHint, type PatchTaskInput, type SmartListId, type Task } from '@vital/dto';
import { Type } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { completeTask, createTaskFromText, patchTask } from '../../../tasks/tasks.service.js';
import { register } from '../registry.js';
import { isToolResult, pageListId, resolveListId, resolveTagIds, resolveTask } from '../resolve.js';
import { needsInput, okResult, type ToolResult } from '../types.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const createInput = z.object({
  text: z.string().trim().min(1).max(2000),
});

const patchInput = z.object({
  taskId: z.string().uuid().optional(),
  matchTitle: z.string().trim().min(1).max(500).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  notes: z.string().max(20_000).nullable().optional(),
  priority: priority.optional(),
  dueYmd: ymd.optional(),
  listName: z.string().trim().min(1).max(120).optional(),
  tagNames: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  pinned: z.boolean().optional(),
});

const completeInput = z.object({
  taskId: z.string().uuid().optional(),
  matchTitle: z.string().trim().min(1).max(500).optional(),
});

function taskBrief(task: Task) {
  return { id: task.id, title: task.title, status: task.status, dueAt: task.dueAt, priority: task.priority };
}

register({
  name: 'tasks.create_from_text',
  label: '创建待办',
  description:
    '把用户原话创建成一条待办。text 必须是用户的原话，不要改写、不要拆开、不要补日期。清单由当前页面决定。',
  parameters: Type.Object({
    text: Type.String({ minLength: 1, maxLength: 2000, description: '用户的原话' }),
  }),
  input: createInput,
  mode: 'mutate',
  handler: async (ctx, input): Promise<ToolResult> => {
    const listId = pageListId(ctx);
    const placed: { listId?: string; smartListId?: SmartListId } =
      listId && (SMART_LIST_IDS as readonly string[]).includes(listId)
        ? { smartListId: listId as SmartListId }
        : listId
          ? { listId }
          : {};
    const task = await createTaskFromText(ctx.userId, {
      text: input.text,
      timezone: ctx.timezone,
      ...placed,
    });
    const undo: ChatUndoHint = { kind: 'delete_task', taskId: task.id };
    return okResult(`已创建「${task.title}」`, taskBrief(task), ['tasks', 'today'], undo);
  },
});

register({
  name: 'tasks.patch',
  label: '修改待办',
  description:
    '修改一条非习惯待办。用 taskId 或 matchTitle 定位。可以改 title、notes、priority、dueYmd、listName、tagNames、estimateMinutes、pinned。不要传重复规则、具体时刻或提醒。',
  parameters: Type.Object({
    taskId: Type.Optional(Type.String()),
    matchTitle: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
    priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
    dueYmd: Type.Optional(Type.String()),
    listName: Type.Optional(Type.String()),
    tagNames: Type.Optional(Type.Array(Type.String())),
    estimateMinutes: Type.Optional(Type.Integer({ minimum: 0 })),
    pinned: Type.Optional(Type.Boolean()),
  }),
  input: patchInput,
  mode: 'mutate',
  handler: async (ctx, input): Promise<ToolResult> => {
    const found = await resolveTask(
      ctx,
      {
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
        ...(input.matchTitle !== undefined ? { matchTitle: input.matchTitle } : {}),
      },
      { includeHabits: false },
    );
    if (isToolResult(found)) return found;
    const task = found.task;
    if (task.habitId) return needsInput('这是习惯打卡，请用 habits.patch 或 habits.tick。');
    const patch: PatchTaskInput = {};
    const previous: Record<string, unknown> = {};
    if (input.title !== undefined && input.title !== task.title) {
      patch.title = input.title;
      previous.title = task.title;
    }
    if (input.notes !== undefined && input.notes !== task.notes) {
      patch.notes = input.notes;
      previous.notes = task.notes;
    }
    if (input.priority !== undefined && input.priority !== task.priority) {
      patch.priority = input.priority;
      previous.priority = task.priority;
    }
    if (input.dueYmd !== undefined) {
      patch.dueYmd = input.dueYmd;
      patch.timezone = ctx.timezone;
      previous.dueAt = task.dueAt;
      previous.isAllDay = task.isAllDay;
    }
    if (input.estimateMinutes !== undefined && input.estimateMinutes !== task.estimateMinutes) {
      patch.estimateMinutes = input.estimateMinutes;
      previous.estimateMinutes = task.estimateMinutes;
    }
    if (input.pinned !== undefined && input.pinned !== task.pinned) {
      patch.pinned = input.pinned;
      previous.pinned = task.pinned;
    }
    if (input.listName !== undefined) {
      const list = await resolveListId(ctx.userId, input.listName);
      if (isToolResult(list)) return list;
      if (list.id !== task.listId) {
        patch.listId = list.id;
        previous.listId = task.listId;
      }
    }
    if (input.tagNames !== undefined) {
      const tags = await resolveTagIds(ctx.userId, input.tagNames);
      if (isToolResult(tags)) return tags;
      patch.tagIds = tags.ids;
      previous.tagIds = task.tagIds;
    }
    if (Object.keys(patch).length === 0) return needsInput('没有要改的内容。');
    const next = await patchTask(ctx.userId, task.id, patch);
    const undo: ChatUndoHint = { kind: 'patch_task', taskId: task.id, previous };
    return okResult(`已更新「${next.title}」`, taskBrief(next), ['tasks', 'today'], undo);
  },
});

register({
  name: 'tasks.complete',
  label: '完成待办',
  description: '完成一条普通待办。如果命中的是习惯打卡，不要完成，改让用户用 habits.tick。',
  parameters: Type.Object({
    taskId: Type.Optional(Type.String()),
    matchTitle: Type.Optional(Type.String()),
  }),
  input: completeInput,
  mode: 'mutate',
  handler: async (ctx, input): Promise<ToolResult> => {
    const found = await resolveTask(
      ctx,
      {
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
        ...(input.matchTitle !== undefined ? { matchTitle: input.matchTitle } : {}),
      },
      { includeHabits: true },
    );
    if (isToolResult(found)) return found;
    if (found.task.habitId) return needsInput(`「${found.task.title}」是习惯打卡，请用 habits.tick。`);
    const done = await completeTask(ctx.userId, found.task.id);
    const undo: ChatUndoHint = {
      kind: 'uncomplete',
      taskId: done.task.id,
      completionId: done.undo.completionId,
    };
    return okResult(`已完成「${done.task.title}」`, taskBrief(done.task), ['tasks', 'today'], undo);
  },
});
