type Listener = () => void;
const listeners = new Set<Listener>();

/** Today and other day-scoped screens refetch after a task is completed or undone. */
export function subscribeTaskMutations(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyTaskMutation(): void {
  for (const listener of listeners) listener();
}
