import type { CaptureDraft } from './messages.js';

const DRAFT_KEY = 'vital.capture.draft';

export async function saveDraft(draft: CaptureDraft): Promise<void> {
  await chrome.storage.session.set({ [DRAFT_KEY]: draft });
}

export async function readDraft(): Promise<CaptureDraft | null> {
  const stored = await chrome.storage.session.get(DRAFT_KEY);
  const value = stored[DRAFT_KEY];
  if (typeof value !== 'object' || value === null) return null;
  const rec = value as Partial<CaptureDraft>;
  if (typeof rec.title !== 'string' || typeof rec.originalUrl !== 'string') return null;
  return {
    title: rec.title,
    note: typeof rec.note === 'string' ? rec.note : '',
    originalUrl: rec.originalUrl,
    extractedText: rec.extractedText ?? null,
    extractedHtml: rec.extractedHtml ?? null,
    excerpt: rec.excerpt ?? null,
    byline: rec.byline ?? null,
    siteName: rec.siteName ?? null,
    imageSrcs: Array.isArray(rec.imageSrcs)
      ? rec.imageSrcs.filter((s) => typeof s === 'string')
      : [],
    selection: typeof rec.selection === 'string' ? rec.selection : '',
    tabId: typeof rec.tabId === 'number' ? rec.tabId : null,
    mode: rec.mode === 'task' ? 'task' : 'inbox',
  };
}

export async function clearDraft(): Promise<void> {
  await chrome.storage.session.remove(DRAFT_KEY);
}
