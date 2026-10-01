import type { ChatInvalidateTag, ChatUndoHint, Task, TaskPriority } from '@vital/dto';
import { Type } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { completeTask, patchTask } from '../../../tasks/tasks.service.js';
import { getTask } from '../../../tasks/tasks.read.js';
import { register } from '../registry.js';
import { firstPage, pageListId } from '../resolve.js';
import { insertPreview } from '../store.js';
import { needsInput, toolError, ORGANIZE_MAX, type ToolCtx, type ToolResult } from '../types.js';

const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const organizeOpSchema = z
  .object({
    taskId: z.string().uuid(),
    complete: z.boolean().optional(),
    dueYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: priority.optional(),
  })
  .refine((op) => op.complete === true || op.dueYmd !== undefined || op.priority !== undefined, {
    message: 'empty op',
  });

export const organizeInputSchema = z.object({
  ops: z.array(organizeOpSchema).min(1).max(ORGANIZE_MAX),
});

export type OrganizeOp = z.infer<typeof organizeOpSchema>;

async function allowedTasks(ctx: ToolCtx): Promise<Map<string, Task> | ToolResult> {
  if (ctx.page.visibleTruncated && ctx.page.visibleTaskIds.length === 0) {
    return needsInput('当前列表太长，请先缩小范围，或点开要整理的几条。');
  }
  const allowed = new Map<string, Task>();
  if (ctx.page.visibleTaskIds.length > 0) {
    for (const id of ctx.page.visibleTaskIds) {
      try {
        const task = await getTask(ctx.userId, id);
        if (task.habitId) continue;
        allowed.set(task.id, task);
      } catch {
        return toolError('TASK_NOT_FOUND', '列表里有一条待办已经不存在。');
      }
    }
  } else {
    if (!pageListId(ctx)) return needsInput('先打开要整理的列表。');
    const page = await firstPage(ctx);
    if (!page) return needsInput('先打开要整理的列表。');
    if (page.limited) return needsInput('当前列表太长，请先缩小范围。');
    for (const task of page.tasks) {
      if (task.habitId === null) allowed.set(task.id, task);
    }
  }
  if (allowed.size === 0) return needsInput('当前没有可整理的待办。');
  return allowed;
}

function isMap(value: Map<string, Task> | ToolResult): value is Map<string, Task> {
  return value instanceof Map;
}

export async function screenOrganize(
  ctx: ToolCtx,
  ops: OrganizeOp[],
): Promise<{ ops: OrganizeOp[]; summary: string } | ToolResult> {
  const allowed = await allowedTasks(ctx);
  if (!isMap(allowed)) return allowed;
  const lines: string[] = [];
  for (const op of ops) {
    const task = allowed.get(op.taskId);
    if (!task) {
      try {
        const row = await getTask(ctx.userId, op.taskId);
        if (row.habitId) return needsInput('习惯打卡请用 habits.tick，不能放进整理。');
      } catch {
        return needsInput('有一条不在当前列表里，请只整理眼前这些待办。');
      }
      return needsInput('有一条不在当前列表里，请只整理眼前这些待办。');
    }
    if (op.complete === true) lines.push(`完成「${task.title}」`);
    if (op.dueYmd) lines.push(`把「${task.title}」改到 ${op.dueYmd}`);
    if (op.priority !== undefined) lines.push(`把「${task.title}」优先级改为 P${String(op.priority)}`);
  }
  return { ops, summary: lines.join('\n') };
}

export async function applyOrganize(
  userId: string,
  timezone: string,
  ops: OrganizeOp[],
): Promise<{ summary: string; invalidate: ChatInvalidateTag[]; undos: { summary: string; undo: ChatUndoHint }[]; errors: string[] }> {
  const undos: { summary: string; undo: ChatUndoHint }[] = [];
  const errors: string[] = [];
  for (const op of ops) {
    try {
      const task = await getTask(userId, op.taskId);
      if (task.habitId) {
        errors.push(`「${task.title}」是习惯打卡，已跳过`);
        continue;
      }
      const patch: { dueYmd?: string; timezone?: string; priority?: TaskPriority } = {};
      const previous: Record<string, unknown> = {};
      if (op.dueYmd) {
        patch.dueYmd = op.dueYmd;
        patch.timezone = timezone;
        previous.dueAt = task.dueAt;
        previous.isAllDay = task.isAllDay;
      }
      if (op.priority !== undefined && op.priority !== task.priority) {
        patch.priority = op.priority;
        previous.priority = task.priority;
      }
      if (Object.keys(previous).length > 0) {
        const next = await patchTask(userId, task.id, patch);
        undos.push({
          summary: `已更新「${next.title}」`,
          undo: { kind: 'patch_task', taskId: task.id, previous },
        });
      }
      if (op.complete === true) {
        const done = await completeTask(userId, task.id);
        undos.push({
          summary: `已完成「${done.task.title}」`,
          undo: { kind: 'uncomplete', taskId: done.task.id, completionId: done.undo.completionId },
        });
      }
    } catch {
      errors.push('有一条没有改成');
    }
  }
  const summary = [...undos.map((item) => item.summary), ...errors].join('\n') || '没有改动';
  const invalidate: ChatInvalidateTag[] = undos.length > 0 ? ['tasks', 'today'] : [];
  return { summary, invalidate, undos, errors };
}

register({
  name: 'tasks.organize',
  label: '整理待办',
  description:
    '一次整理多条眼前的待办。只使用页面给出的 taskId。每条可以 complete、dueYmd 或 priority。这只生成预览，用户确认后才会改。',
  parameters: Type.Object({
    ops: Type.Array(
      Type.Object({
        taskId: Type.String(),
        complete: Type.Optional(Type.Boolean()),
        dueYmd: Type.Optional(Type.String()),
        priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
      }),
      { minItems: 1, maxItems: ORGANIZE_MAX },
    ),
  }),
  input: organizeInputSchema,
  mode: 'confirm',
  handler: async (ctx, input): Promise<ToolResult> => {
    const screened = await screenOrganize(ctx, input.ops);
    if (!('ops' in screened)) return screened;
    const preview = await insertPreview({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: 'tasks.organize',
      args: { ops: screened.ops },
      summary: screened.summary,
    });
    return {
      status: 'preview',
      summary: screened.summary,
      previewId: preview.id,
      expiresAt: preview.expiresAt,
      invalidate: [],
    };
  },
});

