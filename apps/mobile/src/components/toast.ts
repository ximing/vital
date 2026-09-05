export type ToastAction = { label: string; onPress: () => void };

export type ToastItem = {
  message: string;
  action?: ToastAction;
  durationMs?: number;
};

type ToastHostHandle = {
  show: (item: ToastItem) => void;
  clear: () => void;
};

let host: ToastHostHandle | null = null;

export function bindToastHost(h: ToastHostHandle): () => void {
  host = h;
  return () => {
    if (host === h) host = null;
  };
}

function showToast(input: ToastItem | string): void {
  const item: ToastItem = typeof input === 'string' ? { message: input } : input;
  host?.show(item);
}

export const toast: ((input: ToastItem | string) => void) & {
  show: (input: ToastItem | string) => void;
  clear: () => void;
} = Object.assign(showToast, {
  show: showToast,
  clear(): void {
    host?.clear();
  },
});

export const UNDO_MS = 5000;
