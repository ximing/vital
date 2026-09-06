import type {
  ReportEmbeds,
  ReportInboxEmbed,
  ReportTaskEmbed,
  ReportType,
  SyncHead,
} from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { normalizeTrailingNewlines, renderToken, type EntityKind } from '@vital/markdown';

export type { ReportType };

export const POLL_MS = 5000;
export const SAVE_DEBOUNCE_MS = 800;
export const REPORT_TYPES: ReportType[] = ['daily', 'weekly', 'monthly', 'yearly'];

export const EMPTY_EMBEDS: ReportEmbeds = { tasks: {}, inbox: {} };

export type PollAction = {
  fetchEmbeds: boolean;
  toastRemote: boolean;
  reloadBody: boolean;
};

export type SlashQuery = {
  query: string;
  from: number;
  to: number;
};

export type SlashHit = {
  kind: EntityKind;
  id: string;
  title: string;
};

export function parseReportType(value: string | null | undefined): ReportType {
  if (value === 'weekly' || value === 'monthly' || value === 'yearly' || value === 'daily') {
    return value;
  }
  return 'daily';
}

export function isDirty(draft: string, saved: string): boolean {
  return normalizeTrailingNewlines(draft) !== normalizeTrailingNewlines(saved);
}

export function isRevisionConflict(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'REPORT_REVISION_CONFLICT';
}

/** Poll: embeds-only when task/inbox watermarks move; never reload body while dirty. */
export function decidePoll(prev: SyncHead | null, next: SyncHead, dirty: boolean): PollAction {
  if (prev === null) {
    return { fetchEmbeds: false, toastRemote: false, reloadBody: false };
  }
  const tasksMoved = prev.tasksMaxUpdatedAt !== next.tasksMaxUpdatedAt;
  const inboxMoved = prev.inboxMaxUpdatedAt !== next.inboxMaxUpdatedAt;
  const reportsMoved = prev.reportsMaxUpdatedAt !== next.reportsMaxUpdatedAt;
  if (reportsMoved && !dirty) {
    return { fetchEmbeds: false, toastRemote: false, reloadBody: true };
  }
  return {
    fetchEmbeds: tasksMoved || inboxMoved,
    toastRemote: reportsMoved && dirty,
    reloadBody: false,
  };
}

/** Poll must never replace a dirty body, even if a GET sneaks through. */
export function applyRemoteBody(dirty: boolean, localBody: string, remoteBody: string): string {
  return dirty ? localBody : remoteBody;
}

export function mergeEmbeds(local: ReportEmbeds, remote: ReportEmbeds): ReportEmbeds {
  return {
    tasks: { ...local.tasks, ...remote.tasks },
    inbox: { ...local.inbox, ...remote.inbox },
  };
}

export function stubTaskEmbed(id: string, title: string): ReportTaskEmbed {
  return { id, title, status: 'todo', deletedAt: null };
}

export function stubInboxEmbed(id: string, title: string): ReportInboxEmbed {
  return { id, title, status: 'unread', deletedAt: null };
}

export function withStubEmbed(
  embeds: ReportEmbeds,
  kind: EntityKind,
  id: string,
  title: string,
): ReportEmbeds {
  if (kind === 'task') {
    return { ...embeds, tasks: { ...embeds.tasks, [id]: stubTaskEmbed(id, title) } };
  }
  return { ...embeds, inbox: { ...embeds.inbox, [id]: stubInboxEmbed(id, title) } };
}

/**
 * `/query` at start of text or after whitespace. `https://` does not match.
 * `from`/`to` are offsets in `text` (or the prefix `text.slice(0, cursor)`).
 */
export function slashFromText(text: string, cursor: number): SlashQuery | null {
  if (cursor < 1 || cursor > text.length) return null;
  const before = text.slice(0, cursor);
  const slash = before.lastIndexOf('/');
  if (slash < 0) return null;
  if (slash > 0) {
    const prev = before[slash - 1];
    if (prev !== ' ' && prev !== '\n' && prev !== '\t') return null;
  }
  const query = before.slice(slash + 1);
  if (query.includes('\n')) return null;
  return { query, from: slash, to: cursor };
}

export function insertAt(text: string, from: number, to: number, insert: string): string {
  return `${text.slice(0, from)}${insert}${text.slice(to)}`;
}

export function insertEntityToken(
  md: string,
  from: number,
  to: number,
  kind: EntityKind,
  id: string,
): string {
  return insertAt(md, from, to, renderToken(kind, id));
}

export function reportHref(id: string, type: ReportType): string {
  return `/reports/${id}?type=${type}`;
}

export function chipLabel(
  kind: EntityKind,
  id: string,
  embeds: ReportEmbeds,
  fallback: string,
): string {
  if (kind === 'task') {
    const task = embeds.tasks[id];
    if (task?.deletedAt) return fallback;
    return task?.title || fallback;
  }
  const item = embeds.inbox[id];
  if (item?.deletedAt) return fallback;
  return item?.title || fallback;
}

export function chipDeleted(kind: EntityKind, id: string, embeds: ReportEmbeds): boolean {
  if (kind === 'task') return embeds.tasks[id]?.deletedAt != null;
  return embeds.inbox[id]?.deletedAt != null;
}

export function taskChipStatus(id: string, embeds: ReportEmbeds): ReportTaskEmbed['status'] | null {
  return embeds.tasks[id]?.status ?? null;
}
