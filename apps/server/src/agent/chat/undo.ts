import {
  patchHabitInputSchema,
  patchTaskInputSchema,
  type ChatInvalidateTag,
  type ChatUndoHint,
} from '@vital/dto';
import { and, eq } from 'drizzle-orm';
import { enqueueContinuityForOutcomes, samePlanRevision } from '../../continuity/plan-apply.js';
import { getDb } from '../../db/index.js';
import { tasks } from '../../db/schema.js';
import { AppError } from '../../errors.js';
import { patchHabit } from '../../habits/habits.service.js';
import { deleteTask, patchTask, uncompleteTask } from '../../tasks/tasks.service.js';

export async function applyUndo(userId: string, hint: ChatUndoHint): Promise<ChatInvalidateTag[]> {
  switch (hint.kind) {
    case 'uncomplete':
      await uncompleteTask(userId, hint.taskId, { completionId: hint.completionId });
      return ['tasks', 'today', 'habits'];
    case 'delete_task':
      await deleteTask(userId, hint.taskId);
      return ['tasks', 'today'];
    case 'pause_habit':
      await patchHabit(userId, hint.habitId, { active: false });
      return ['habits', 'today'];
    case 'patch_habit': {
      const parsed = patchHabitInputSchema.safeParse(hint.previous);
      if (!parsed.success) throw AppError.of(400, 'VALIDATION_ERROR');
      await patchHabit(userId, hint.habitId, parsed.data);
      return ['habits', 'today'];
    }
    case 'patch_task': {
      const parsed = patchTaskInputSchema.safeParse(hint.previous);
      if (!parsed.success) throw AppError.of(400, 'VALIDATION_ERROR');
      await patchTask(userId, hint.taskId, parsed.data);
      const tags: ChatInvalidateTag[] = ['tasks', 'today'];
      if (parsed.data.isMilestone !== undefined || parsed.data.outcomeId !== undefined) tags.push('outcomes');
      return tags;
    }
    case 'plan': {
      const tags = new Set<ChatInvalidateTag>();
      const order: string[] = [];
      const byTask = new Map<string, typeof hint.steps>();
      for (const step of hint.steps) {
        const list = byTask.get(step.taskId);
        if (!list) {
          order.push(step.taskId);
          byTask.set(step.taskId, [step]);
        } else {
          list.push(step);
        }
      }
      const outcomeIds: string[] = [];
      const revisions = hint.afterRevisions ?? {};
      for (const taskId of order) {
        const expected = revisions[taskId];
        const [row] = await getDb()
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
          .limit(1);
        if (expected) {
          if (!row || row.deletedAt) continue;
          if (!samePlanRevision(row.updatedAt, expected)) continue;
        }
        if (row?.outcomeId) outcomeIds.push(row.outcomeId);
        for (const step of byTask.get(taskId) ?? []) {
          for (const tag of await applyUndo(userId, step)) tags.add(tag);
        }
      }
      if (outcomeIds.length > 0) {
        await getDb().transaction(async (tx) => {
          await enqueueContinuityForOutcomes(tx, userId, outcomeIds, new Date());
        });
      }
      return [...tags];
    }
    default:
      throw AppError.of(400, 'VALIDATION_ERROR');
  }
}
