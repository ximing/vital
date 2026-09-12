import { resolve, Service } from '@rabjs/react';
import type { InboxPreview } from '@vital/dto';
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

export class InboxUiService extends Service {
  fontSize: ReaderSize = readFont();
  pasteNonce = 0;
  pending: PendingSave[] = [];
  preview: InboxPreview | null = null;
  previewTitle = '';

  setFontSize(size: ReaderSize): void {
    try {
      window.localStorage.setItem(FONT_KEY, size);
    } catch {
      // Quota / private mode.
    }
    this.fontSize = size;
  }

  requestPaste(): void {
    this.pasteNonce += 1;
  }

  setPreview(preview: InboxPreview | null): void {
    this.preview = preview;
    this.previewTitle = preview?.title ?? '';
  }

  setPreviewTitle(previewTitle: string): void {
    this.previewTitle = previewTitle;
  }

  upsertPending(save: PendingSave): void {
    const idx = this.pending.findIndex((item) => item.id === save.id);
    if (idx < 0) {
      this.pending = [...this.pending, save];
      return;
    }
    const pending = this.pending.slice();
    pending[idx] = save;
    this.pending = pending;
  }

  removePending(id: string): void {
    this.pending = this.pending.filter((item) => item.id !== id);
  }

  reset(): void {
    try {
      window.localStorage.removeItem(FONT_KEY);
    } catch {
      // jsdom / private mode.
    }
    this.fontSize = 'md';
    this.pasteNonce = 0;
    this.pending = [];
    this.preview = null;
    this.previewTitle = '';
  }
}

export function inboxUi(): InboxUiService {
  return resolve(InboxUiService);
}

export function resetInboxUi(): void {
  inboxUi().reset();
}
