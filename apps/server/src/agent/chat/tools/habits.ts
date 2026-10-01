import type { ChatUndoHint, Habit, PatchHabitInput } from '@vital/dto';
import { Type } from '@earendil-works/pi-ai';
import { z } from 'zod';
import {
  createHabit,
  ensureOpenTodayInstance,
  listHabits,
  patchHabit,
} from '../../../habits/habits.service.js';
import { completeTask } from '../../../tasks/tasks.service.js';
import { register } from '../registry.js';
import { normName } from '../resolve.js';
import { needsInput, okResult, toolError, type ToolCtx, type ToolResult } from '../types.js';

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const createInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(['daily', 'count']),
    targetCount: z.number().int().min(1).max(99).optional(),
    windowStart: hm.optional(),
    windowEnd: hm.optional(),
  })
  .refine((value) => value.kind !== 'count' || value.targetCount !== undefined, {
    message: 'targetCount required',
  });

const patchInput = z.object({
  habitId: z.string().uuid().optional(),
  matchName: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  targetCount: z.number().int().min(1).max(99).nullable().optional(),
  windowStart: hm.nullable().optional(),
  windowEnd: hm.nullable().optional(),
  active: z.boolean().optional(),
});

const tickInput = z.object({
  habitId: z.string().uuid().optional(),
  matchName: z.string().trim().min(1).max(120).optional(),
});

function brief(habit: Habit) {
  return {
    id: habit.id,
    name: habit.name,
    kind: habit.kind,
    active: habit.active,
    todayDone: habit.todayDone,
    todayTotal: habit.todayTotal,
  };
}

async function findHabit(ctx: ToolCtx, input: { habitId?: string; matchName?: string }): Promise<{ habit: Habit } | ToolResult> {
  const habits = await listHabits(ctx.userId, ctx.timezone);
  if (input.habitId) {
    const habit = habits.find((item) => item.id === input.habitId);
    if (!habit) return toolError('NOT_FOUND', '没有找到这个习惯。');
    return { habit };
  }
  const name = normName(input.matchName ?? '');
  if (!name) return needsInput('要说清是哪个习惯。');
  const hits = habits.filter((item) => normName(item.name) === name);
  if (hits.length === 0) return needsInput(`没有叫「${name}」的习惯。`);
  if (hits.length > 1) return needsInput(`有多个习惯叫「${name}」。`);
  const habit = hits[0];
  if (!habit) return needsInput(`没有叫「${name}」的习惯。`);
  return { habit };
}

function isMiss(value: { habit: Habit } | ToolResult): value is ToolResult {
  return 'status' in value && !('kind' in value && 'todayDone' in value);
}

register({
  name: 'habits.create',
  label: '创建习惯',
  description: '创建一个习惯。kind 用 daily 或 count。count 必须带 targetCount。不要绑定线程。',
  parameters: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 120 }),
    kind: Type.Union([Type.Literal('daily'), Type.Literal('count')]),
    targetCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 99 })),
    windowStart: Type.Optional(Type.String()),
    windowEnd: Type.Optional(Type.String()),
  }),
  input: createInput,
  mode: 'mutate',
  handler: async (ctx, input): Promise<ToolResult> => {
    const habit = await createHabit(
      ctx.userId,
      {
        name: input.name,
        kind: input.kind,
        ...(input.targetCount !== undefined ? { targetCount: input.targetCount } : {}),
        ...(input.windowStart !== undefined ? { windowStart: input.windowStart } : {}),
        ...(input.windowEnd !== undefined ? { windowEnd: input.windowEnd } : {}),
      },
      'agent',
    );
    const undo: ChatUndoHint = { kind: 'pause_habit', habitId: habit.id };
    return okResult(`已创建习惯「${habit.name}」`, brief(habit), ['habits', 'today'], undo);
  },
});

register({
  name: 'habits.patch',
  label: '修改习惯',
  description: '修改一个习惯的名字、次数、时段或是否启用。用 habitId 或 matchName 定位。不要改所属线程。',
  parameters: Type.Object({
    habitId: Type.Optional(Type.String()),
    matchName: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    targetCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 99 })),
    windowStart: Type.Optional(Type.String()),
    windowEnd: Type.Optional(Type.String()),
    active: Type.Optional(Type.Boolean()),
  }),
  input: patchInput,
  mode: 'mutate',
  handler: async (ctx, input): Promise<ToolResult> => {
    const found = await findHabit(ctx, {
      ...(input.habitId !== undefined ? { habitId: input.habitId } : {}),
      ...(input.matchName !== undefined ? { matchName: input.matchName } : {}),
    });
    if (isMiss(found)) return found;
    const habit = found.habit;
    const patch: PatchHabitInput = {};
    const previous: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== habit.name) {
      patch.name = input.name;
      previous.name = habit.name;
    }
    if (input.targetCount !== undefined && input.targetCount !== habit.targetCount) {
      patch.targetCount = input.targetCount;
      previous.targetCount = habit.targetCount;
    }
    if (input.windowStart !== undefined && input.windowStart !== habit.windowStart) {
      patch.windowStart = input.windowStart;
      previous.windowStart = habit.windowStart;
    }
    if (input.windowEnd !== undefined && input.windowEnd !== habit.windowEnd) {
      patch.windowEnd = input.windowEnd;
      previous.windowEnd = habit.windowEnd;
    }
    if (input.active !== undefined && input.active !== habit.active) {
      patch.active = input.active;
      previous.active = habit.active;
    }
    if (Object.keys(patch).length === 0) return needsInput('没有要改的内容。');
    const next = await patchHabit(ctx.userId, habit.id, patch);
    const undo: ChatUndoHint = { kind: 'patch_habit', habitId: habit.id, previous };
    return okResult(`已更新习惯「${next.name}」`, brief(next), ['habits', 'today'], undo);
  },
});

register({
  name: 'habits.tick',
  label: '习惯打卡',
  description: '给一个习惯打一次卡，包括窗口外的补打。用 habitId 或 matchName 定位。',
  parameters: Type.Object({
    habitId: Type.Optional(Type.String()),
    matchName: Type.Optional(Type.String()),
  }),
  input: tickInput,
  mode: 'mutate',
  handler: async (ctx, input): Promise<ToolResult> => {
    const found = await findHabit(ctx, {
      ...(input.habitId !== undefined ? { habitId: input.habitId } : {}),
      ...(input.matchName !== undefined ? { matchName: input.matchName } : {}),
    });
    if (isMiss(found)) return found;
    const taskId = await ensureOpenTodayInstance(ctx.userId, found.habit.id, ctx.timezone);
    if (!taskId) return okResult(`「${found.habit.name}」今天已经完成`, brief(found.habit), ['habits', 'today']);
    const done = await completeTask(ctx.userId, taskId, { skipHabitRelay: true });
    const habits = await listHabits(ctx.userId, ctx.timezone);
    const next = habits.find((item) => item.id === found.habit.id) ?? found.habit;
    const undo: ChatUndoHint = { kind: 'uncomplete', taskId, completionId: done.undo.completionId };
    return okResult(`已打卡「${next.name}」`, brief(next), ['habits', 'today', 'tasks'], undo);
  },
});
