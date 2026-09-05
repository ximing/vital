import type { InboxPreview } from '@vital/dto';
import { create } from 'zustand';
import { type PendingSave, type ReaderSize } from './model';

const FONT_KEY = 'vital:reader-size';

function readFont(): ReaderSize {
  if (typeof window === 'undefined') return 'md';
  try {
    const value = window.localStorage.getItem(FONT_KEY);
    if (value === 'sm' || value === 'md' || value === 'lg') return value;
  } catch {
    // Private mode.
  }
  return 'md';
}

type InboxUi = {
  fontSize: ReaderSize;
  pasteNonce: number;
  pending: PendingSave[];
  preview: InboxPreview | null;
  previewTitle: string;
  setFontSize: (size: ReaderSize) => void;
  requestPaste: () => void;
  setPreview: (preview: InboxPreview | null) => void;
  setPreviewTitle: (title: string) => void;
  upsertPending: (save: PendingSave) => void;
  removePending: (id: string) => void;
};

export const useInboxUi = create<InboxUi>((set) => ({
  fontSize: readFont(),
  pasteNonce: 0,
  pending: [],
  preview: null,
  previewTitle: '',
  setFontSize: (size) => {
    try {
      window.localStorage.setItem(FONT_KEY, size);
    } catch {
      // Quota / private mode.
    }
    set({ fontSize: size });
  },
  requestPaste: () => set((s) => ({ pasteNonce: s.pasteNonce + 1 })),
  setPreview: (preview) =>
    set({
      preview,
      previewTitle: preview?.title ?? '',
    }),
  setPreviewTitle: (previewTitle) => set({ previewTitle }),
  upsertPending: (save) =>
    set((s) => {
      const idx = s.pending.findIndex((item) => item.id === save.id);
      if (idx < 0) return { pending: [...s.pending, save] };
      const pending = s.pending.slice();
      pending[idx] = save;
      return { pending };
    }),
  removePending: (id) => set((s) => ({ pending: s.pending.filter((item) => item.id !== id) })),
}));

export function resetInboxUi(): void {
  try {
    window.localStorage.removeItem(FONT_KEY);
  } catch {
    // jsdom / private mode.
  }
  useInboxUi.setState({
    fontSize: 'md',
    pasteNonce: 0,
    pending: [],
    preview: null,
    previewTitle: '',
  });
}
