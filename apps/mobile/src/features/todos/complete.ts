import type { Task } from '@vital/dto';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { toast, UNDO_MS } from '../../components/toast';
import { humanError } from '../../lib/errors';

export async function toggleComplete(
  task: Task,
  onTask: (next: Task) => void,
): Promise<void> {
  try {
    if (task.status === 'done') {
      return;
    }
    const res = await client.completeTask(task.id);
    onTask(res.task);
    toast({
      message: copy.actions.completed,
      durationMs: UNDO_MS,
      action: {
        label: copy.actions.undo,
        onPress: () => {
          void client
            .uncompleteTask(task.id, { completionId: res.undo.completionId })
            .then(onTask)
            .catch((err: unknown) => toast(humanError(err)));
        },
      },
    });
  } catch (err) {
    toast(humanError(err));
  }
}
