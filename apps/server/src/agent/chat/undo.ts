import {
  patchHabitInputSchema,
  patchTaskInputSchema,
  type ChatInvalidateTag,
  type ChatUndoHint,
} from '@vital/dto';
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
      return ['tasks', 'today'];
    }
    default:
      throw AppError.of(400, 'VALIDATION_ERROR');
  }
}
