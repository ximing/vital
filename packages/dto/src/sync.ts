import { z } from 'zod';
import { uuidSchema } from './lists.js';
import type { InboxItem } from './inbox.js';
import type { ReportListItem } from './reports.js';
import type { Task } from './tasks.js';

export interface SyncHead {
  tasksMaxUpdatedAt: string | null;
  inboxMaxUpdatedAt: string | null;
  reportsMaxUpdatedAt: string | null;
  revision: number;
}

/**
 * Lookback applied when a pull finishes (truncated=false) and the cursor
 * advances to serverTime. Covers writes whose `updatedAt` was stamped before
 * commit and therefore lagged the previous snapshot.
 */
export const SYNC_CURSOR_OVERLAP_MS = 10_000;

const SYNC_CURSOR_VERSION = 's1';

/** Per-collection keyset: rows with `(updated_at, id) > (ts, id)`. Empty `id` means "start of `ts`". */
export interface SyncKeyset {
  ts: string;
  id: string;
}

/**
 * One opaque `since` / `nextSince` value packs three independent keysets.
 * A single `{ts}|{id}` cannot resume tasks, inbox, and reports together:
 * they do not share an id space, and one collection can truncate while
 * another does not.
 */
export interface SyncCursor {
  tasks: SyncKeyset;
  inbox: SyncKeyset;
  reports: SyncKeyset;
}

/** Incremental pull. Tasks/inbox include `deletedAt` tombstones. Reports omit `bodyMd`. */
export interface SyncChanges {
  serverTime: string;
  head: SyncHead;
  tasks: Task[];
  inbox: InboxItem[];
  reports: ReportListItem[];
  truncated: boolean;
  /** Opaque cursor to pass as the next `since`. Always set. */
  nextSince: string;
}

export const SYNC_EVENTS_PATH = '/api/v1/sync/events';

function isKeysetId(id: string): boolean {
  return id === '' || uuidSchema.safeParse(id).success;
}

function isIsoInstant(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function encodeSyncCursor(cursor: SyncCursor): string {
  return [
    SYNC_CURSOR_VERSION,
    cursor.tasks.ts,
    cursor.tasks.id,
    cursor.inbox.ts,
    cursor.inbox.id,
    cursor.reports.ts,
    cursor.reports.id,
  ].join('|');
}

export function decodeSyncCursor(raw: string): SyncCursor | null {
  const parts = raw.split('|');
  if (parts.length !== 7) return null;
  const [ver, tTs, tId, iTs, iId, rTs, rId] = parts;
  if (ver !== SYNC_CURSOR_VERSION) return null;
  if (tTs === undefined || tId === undefined || iTs === undefined || iId === undefined) return null;
  if (rTs === undefined || rId === undefined) return null;
  if (![tTs, iTs, rTs].every(isIsoInstant)) return null;
  if (![tId, iId, rId].every(isKeysetId)) return null;
  return {
    tasks: { ts: tTs, id: tId },
    inbox: { ts: iTs, id: iId },
    reports: { ts: rTs, id: rId },
  };
}

export function isoToSyncCursor(at: Date): SyncCursor {
  const ts = at.toISOString();
  const key: SyncKeyset = { ts, id: '' };
  return { tasks: key, inbox: { ...key }, reports: { ...key } };
}

export function overlapSyncCursor(serverTime: Date): SyncCursor {
  return isoToSyncCursor(new Date(serverTime.getTime() - SYNC_CURSOR_OVERLAP_MS));
}

export type ParsedSyncSince =
  | { kind: 'iso'; at: Date }
  | { kind: 'cursor'; cursor: SyncCursor };

export function parseSyncSince(raw: string): ParsedSyncSince | null {
  if (raw.startsWith(`${SYNC_CURSOR_VERSION}|`)) {
    const cursor = decodeSyncCursor(raw);
    return cursor ? { kind: 'cursor', cursor } : null;
  }
  if (!isIsoInstant(raw)) return null;
  return { kind: 'iso', at: new Date(raw) };
}

export function isValidSyncSince(value: string): boolean {
  return parseSyncSince(value) !== null;
}

export const syncChangesQuerySchema = z.object({
  since: z
    .string()
    .min(1)
    .max(2048)
    .refine((value) => isValidSyncSince(value), 'iso datetime or sync cursor'),
  limit: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? 200 : Number(value)))
    .pipe(z.number().int().min(1).max(500)),
});
export type SyncChangesQuery = z.infer<typeof syncChangesQuerySchema>;

export type SyncHelloMessage = { type: 'hello'; token: string };
export type SyncReadyMessage = { type: 'ready' };
export type SyncInvalidateMessage = { type: 'invalidate'; at: string };
