import { deviceCalendarWindow } from '@vital/dto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { db } from '../src/db/index.js';
import { tasks } from '../src/db/schema.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { registerUser } from './helpers/session.js';

const NOW = new Date('2026-10-13T04:00:00.000Z');
const SPAN = deviceCalendarWindow('Asia/Shanghai', NOW);
const START = '2026-10-13T01:30:00.000Z';
const MOVED = '2026-10-13T06:00:00.000Z';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

function event(overrides: Record<string, unknown> = {}) {
  return { key: 'mac:week-sync', title: '周会', start: START, end: null, allDay: false, ...overrides };
}

async function sync(
  token: string,
  source: 'mac' | 'ios' | 'android',
  items: ReturnType<typeof event>[],
) {
  return injectJson(app, {
    method: 'POST',
    url: '/api/v1/tasks/device-calendar',
    token,
    payload: { source, windowStart: SPAN.windowStart, windowEnd: SPAN.windowEnd, events: items },
  });
}

async function owned(userId: string) {
  return db.select().from(tasks).where(eq(tasks.userId, userId));
}

describe('device calendar tasks', () => {
  it('adds, updates, and removes a calendar task without touching notes or priority', async () => {
    const alice = await registerUser(app);
    const created = await sync(alice.token, 'mac', [event()]);
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ created: 1, updated: 0, removed: 0 });

    const [row] = await owned(alice.id);
    expect(row?.title).toBe('周会');
    expect(row?.calendarKey).toBe('mac:week-sync');
    expect(row?.priority).toBe(3);
    expect(row?.status).toBe('todo');
    expect(row?.isAllDay).toBe(false);
    expect(row?.startAt?.toISOString()).toBe(START);
    expect(row?.dueAt?.toISOString()).toBe(START);
    if (!row) throw new Error('missing task');

    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${row.id}`,
      token: alice.token,
      payload: { priority: 1, notes: '带上材料' },
    });
    expect(patched.statusCode).toBe(200);

    const updated = await sync(alice.token, 'mac', [event({ title: '改期', start: MOVED })]);
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ created: 0, updated: 1, removed: 0 });
    const [saved] = await owned(alice.id);
    expect(saved?.id).toBe(row.id);
    expect(saved?.title).toBe('改期');
    expect(saved?.startAt?.toISOString()).toBe(MOVED);
    expect(saved?.dueAt?.toISOString()).toBe(MOVED);
    expect(saved?.priority).toBe(1);
    expect(saved?.notesMd).toBe('带上材料');
    expect(saved?.calendarKey).toBe('mac:week-sync');

    const removed = await sync(alice.token, 'mac', []);
    expect(removed.json()).toEqual({ created: 0, updated: 0, removed: 1 });
    const [gone] = await owned(alice.id);
    expect(gone?.deletedAt).toBeInstanceOf(Date);
    expect(gone?.calendarKey).toBeNull();

    const again = await sync(alice.token, 'mac', [event()]);
    expect(again.json()).toEqual({ created: 1, updated: 0, removed: 0 });
    const rows = await owned(alice.id);
    expect(rows.filter((item) => item.deletedAt === null)).toHaveLength(1);
  });

  it('keeps a dismissed calendar key so the same event is not added again', async () => {
    const alice = await registerUser(app);
    await sync(alice.token, 'mac', [event()]);
    const [row] = await owned(alice.id);
    if (!row) throw new Error('missing task');
    const deleted = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/tasks/${row.id}`,
      token: alice.token,
    });
    expect(deleted.statusCode).toBe(204);

    const again = await sync(alice.token, 'mac', [event()]);
    expect(again.json()).toEqual({ created: 0, updated: 0, removed: 0 });
    const [kept] = await owned(alice.id);
    expect(kept?.id).toBe(row.id);
    expect(kept?.deletedAt).toBeInstanceOf(Date);
    expect(kept?.calendarKey).toBe('mac:week-sync');
  });

  it('leaves a completed task and another device alone when this calendar is empty', async () => {
    const alice = await registerUser(app);
    await sync(alice.token, 'mac', [event()]);
    const [row] = await owned(alice.id);
    if (!row) throw new Error('missing task');
    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${row.id}/complete`,
      token: alice.token,
    });
    expect(done.statusCode).toBe(200);

    const cleared = await sync(alice.token, 'mac', []);
    expect(cleared.json()).toEqual({ created: 0, updated: 0, removed: 0 });
    const phone = await sync(alice.token, 'ios', []);
    expect(phone.json()).toEqual({ created: 0, updated: 0, removed: 0 });
    const [kept] = await owned(alice.id);
    expect(kept?.status).toBe('done');
    expect(kept?.deletedAt).toBeNull();
    expect(kept?.calendarKey).toBe('mac:week-sync');
  });

  it('rejects an event key from another source and ignores a start outside the window', async () => {
    const alice = await registerUser(app);
    const foreign = await sync(alice.token, 'mac', [event({ key: 'ios:other' })]);
    expect(foreign.statusCode).toBe(400);

    const outside = await sync(alice.token, 'mac', [event({ start: '2026-10-01T01:00:00.000Z' })]);
    expect(outside.statusCode).toBe(200);
    expect(outside.json()).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(await owned(alice.id)).toHaveLength(0);
  });
});
