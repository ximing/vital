const closers: Array<() => void> = [];
let undoComplete: (() => void) | null = null;

export function pushShortcutLayer(close: () => void): () => void {
  closers.push(close);
  return () => {
    const index = closers.lastIndexOf(close);
    if (index >= 0) closers.splice(index, 1);
  };
}

export function closeTopShortcutLayer(): boolean {
  const close = closers[closers.length - 1];
  if (!close) return false;
  close();
  return true;
}

export function registerUndoComplete(handler: () => void): () => void {
  undoComplete = handler;
  return () => {
    if (undoComplete === handler) undoComplete = null;
  };
}

export function runUndoComplete(): boolean {
  if (!undoComplete) return false;
  undoComplete();
  return true;
}
