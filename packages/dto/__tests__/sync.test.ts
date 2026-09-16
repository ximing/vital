import { describe, expect, it } from 'vitest';
import {
  decodeSyncCursor,
  encodeSyncCursor,
  isoToSyncCursor,
  overlapSyncCursor,
  parseSyncSince,
  SYNC_CURSOR_OVERLAP_MS,
  syncChangesQuerySchema,
  type SyncCursor,
} from '../src/sync.js';

const TS = '2026-09-01T00:00:00.000Z';
const ID = '11111111-1111-4111-8111-111111111111';

const cursor: SyncCursor = {
  tasks: { ts: TS, id: ID },
  inbox: { ts: TS, id: '' },
  reports: { ts: '2026-09-02T00:00:00.000Z', id: ID },
};

describe('syncChangesQuerySchema', () => {
  it('accepts ISO since and defaults limit to 200', () => {
    const parsed = syncChangesQuerySchema.parse({ since: TS });
    expect(parsed.since).toBe(TS);
    expect(parsed.limit).toBe(200);
  });

  it('accepts an opaque compound cursor as since', () => {
    const encoded = encodeSyncCursor(cursor);
    const parsed = syncChangesQuerySchema.parse({ since: encoded, limit: '50' });
    expect(parsed.since).toBe(encoded);
    expect(parsed.limit).toBe(50);
  });

  it('rejects missing, invalid, or out-of-range values', () => {
    expect(syncChangesQuerySchema.safeParse({}).success).toBe(false);
    expect(syncChangesQuerySchema.safeParse({ since: 'yesterday' }).success).toBe(false);
    expect(syncChangesQuerySchema.safeParse({ since: 's1|not-a-date|||||' }).success).toBe(false);
    expect(syncChangesQuerySchema.safeParse({ since: TS, limit: '0' }).success).toBe(false);
    expect(syncChangesQuerySchema.safeParse({ since: TS, limit: '501' }).success).toBe(false);
  });
});

describe('sync cursor codec', () => {
  it('round-trips three collection keysets, including empty ids', () => {
    const encoded = encodeSyncCursor(cursor);
    expect(encoded.startsWith('s1|')).toBe(true);
    expect(decodeSyncCursor(encoded)).toEqual(cursor);
  });

  it('parses ISO since as exclusive-timestamp mode', () => {
    expect(parseSyncSince(TS)).toEqual({ kind: 'iso', at: new Date(TS) });
    expect(parseSyncSince(encodeSyncCursor(cursor))).toEqual({ kind: 'cursor', cursor });
    expect(parseSyncSince('nope')).toBeNull();
  });

  it('builds an overlap cursor 10s behind serverTime', () => {
    const serverTime = new Date('2026-09-01T00:00:10.000Z');
    expect(overlapSyncCursor(serverTime)).toEqual(isoToSyncCursor(new Date('2026-09-01T00:00:00.000Z')));
    expect(SYNC_CURSOR_OVERLAP_MS).toBe(10_000);
  });
});
