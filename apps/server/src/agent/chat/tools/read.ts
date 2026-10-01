import type { Task } from '@vital/dto';
import { Type } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { listHabits } from '../../../habits/habits.service.js';
import { getTodayDashboard } from '../../../outcomes/outcomes.service.js';
import { register } from '../registry.js';
import { firstPage, pageListId } from '../resolve.js';
import { needsInput, okResult, type ToolCtx, type ToolResult } from '../types.js';

const empty = z.object({}).strip();

function slimTask(task: Task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    estimateMinutes: task.estimateMinutes,
    dueAt: task.dueAt,
    habit: task.habitId !== null,
  };
}

register({
  name: 'read.today',
  label: '看今天',
  description: '读取今天的线程、待办和当下建议。不要用它修改任何数据。',
  parameters: Type.Object({}),
  input: empty,
  mode: 'read',
  handler: async (ctx: ToolCtx): Promise<ToolResult> => {
    const dash = await getTodayDashboard(ctx.userId, ctx.timezone);
    const tasks = dash.tasks.filter((task) => task.habitId === null).slice(0, 20).map(slimTask);
    return okResult('今天的安排', {
      outcomes: dash.outcomes.slice(0, 12).map((outcome) => ({
        id: outcome.id,
        name: outcome.name,
        signal: outcome.ruleSignal,
        next: outcome.ruleNextStep,
        openTaskCount: outcome.openTaskCount,
      })),
      tasks,
      now: {
        quiet: dash.now.quiet,
        continuousMinutes: dash.now.continuousMinutes,
        recommendations: dash.now.recommendations.map((item) => ({
          taskId: item.taskId,
          title: item.title,
          estimateMinutes: item.estimateMinutes,
        })),
      },
      inboxPending: dash.pulse.inboxPending,
    }, []);
  },
});

register({
  name: 'read.tasks',
  label: '看当前列表',
  description: '读取用户当前打开的列表，最多 20 条。清单由页面决定，不要自己传 listId。',
  parameters: Type.Object({}),
  input: empty,
  mode: 'read',
  handler: async (ctx): Promise<ToolResult> => {
    if (!pageListId(ctx)) return needsInput('先打开一个列表，我才能看到待办。');
    const page = await firstPage(ctx);
    if (!page) return needsInput('先打开一个列表，我才能看到待办。');
    return okResult(page.limited ? '当前列表的前 20 条' : '当前列表', {
      listId: pageListId(ctx),
      limited: page.limited,
      tasks: page.tasks.map(slimTask),
    }, []);
  },
});

register({
  name: 'read.habits',
  label: '看习惯',
  description: '读取全部习惯和今天的进度。',
  parameters: Type.Object({}),
  input: empty,
  mode: 'read',
  handler: async (ctx): Promise<ToolResult> => {
    const habits = await listHabits(ctx.userId, ctx.timezone);
    return okResult('习惯', {
      habits: habits.map((habit) => ({
        id: habit.id,
        name: habit.name,
        kind: habit.kind,
        active: habit.active,
        targetCount: habit.targetCount,
        windowStart: habit.windowStart,
        windowEnd: habit.windowEnd,
        todayDone: habit.todayDone,
        todayTotal: habit.todayTotal,
      })),
    }, []);
  },
});
