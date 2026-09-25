/** Local title/notes draft vs the last server task. Kept pure so the sheet can be tested without React Native. */

export type TextDraft = {
  title: string;
  notes: string;
  titleDirty: boolean;
  notesDirty: boolean;
};

export function titleIsDirty(serverTitle: string, title: string): boolean {
  const trimmed = title.trim();
  return trimmed !== '' && trimmed !== serverTitle;
}

/** Fields worth sending. An empty title is not a save — the caller restores the server title. */
export function textPatch(
  task: { title: string; notes: string },
  title: string,
  notes: string,
): { title?: string; notes?: string } | null {
  const input: { title?: string; notes?: string } = {};
  const nextTitle = title.trim();
  if (nextTitle !== '' && nextTitle !== task.title) input.title = nextTitle;
  if (notes !== task.notes) input.notes = notes;
  if (input.title === undefined && input.notes === undefined) return null;
  return input;
}

/**
 * Fold a patch response into the open draft.
 * A response that did not carry title/notes must not replace text the user is still editing.
 * A response that did must not replace keystrokes that landed after the request was built.
 */
export function applyServerText(
  draft: TextDraft,
  next: { title: string; notes: string },
  sent: { title?: string | null; notes?: string | null },
): TextDraft {
  let title = draft.title;
  let notes = draft.notes;
  let titleDirty = draft.titleDirty;
  let notesDirty = draft.notesDirty;

  if (sent.title !== undefined && sent.title !== null) {
    if (title.trim() === next.title) {
      title = next.title;
      titleDirty = false;
    } else {
      titleDirty = true;
    }
  } else if (!titleDirty) {
    title = next.title;
  }

  if (sent.notes !== undefined && sent.notes !== null) {
    if (notes === next.notes) {
      notesDirty = false;
    } else {
      notesDirty = true;
    }
  } else if (!notesDirty) {
    notes = next.notes;
  }

  return { title, notes, titleDirty, notesDirty };
}

/** A reload may arrive while the draft is newer than the payload. Keep the newer side. */
export function mergeLoadedText(draft: TextDraft, next: { title: string; notes: string }): TextDraft {
  const titleDirty = draft.titleDirty ? titleIsDirty(next.title, draft.title) : false;
  const notesDirty = draft.notesDirty ? draft.notes !== next.notes : false;
  return {
    title: titleDirty ? draft.title : next.title,
    notes: notesDirty ? draft.notes : next.notes,
    titleDirty,
    notesDirty,
  };
}

export type ProposalSubtask = { title: string; estimateMinutes: number | null };

export function proposalSubtasks(payload: Record<string, unknown>): ProposalSubtask[] {
  const raw = payload['subtasks'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ProposalSubtask[] => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record['title'] !== 'string' || record['title'].trim() === '') return [];
    const estimate = record['estimateMinutes'];
    return [
      {
        title: record['title'],
        estimateMinutes: typeof estimate === 'number' && estimate > 0 ? estimate : null,
      },
    ];
  });
}

export function proposalDraft(payload: Record<string, unknown>): string {
  const draft = payload['draft'];
  return typeof draft === 'string' ? draft : '';
}

export function proposalDeferCount(payload: Record<string, unknown>): number | null {
  const value = payload['deferCount'];
  return typeof value === 'number' && value > 0 ? value : null;
}
