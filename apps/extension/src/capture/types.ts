import {
  inboxListUrl,
  inboxReaderUrl,
  type SaveFeedbackEvent,
  type SaveKind,
} from '../capture-helpers.js';
import { WEB_URL } from '../config.js';
import { copy } from '../i18n.js';

export interface CaptureOutcome {
  kind: SaveKind;
  id: string;
}

export type Announce = (
  event: SaveFeedbackEvent,
  action?: { label: string; url: string },
) => Promise<void>;

export interface CommitResult {
  outcome: CaptureOutcome;
  failed: number;
}

export function outcomeAction(outcome: CaptureOutcome): { label: string; url: string } {
  const url = outcome.kind === 'task' ? inboxListUrl(WEB_URL) : inboxReaderUrl(WEB_URL, outcome.id);
  return { label: copy.toastOpen, url };
}

export async function announceSaved(report: Announce, outcome: CaptureOutcome) {
  await report({ type: 'saved', kind: outcome.kind }, outcomeAction(outcome));
}
