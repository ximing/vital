import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { inboxId, registerUser } from './helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

function shanghai(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: 'Asia/Shanghai' }).startOf('day').toUTC().toISO() ?? '';
}

describe('recurrence flow', () => {
  it('weekly BYDAY=MO,WE,FR dtstart Monday complete Wednesday → next Friday', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: {
        title: 'MWF',
        listId: inbox,
        isAllDay: true,
        dueAt: shanghai('2026-03-09'),
        recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().recurrenceDtstart).toBe(created.json().dueAt);

    const first = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${created.json().id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().task.status).toBe('todo');
    const wed = DateTime.fromISO(first.json().task.dueAt as string, { zone: 'utc' }).setZone(
      'Asia/Shanghai',
    );
    expect(wed.toISODate()).toBe('2026-03-11');

    const second = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${created.json().id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    const fri = DateTime.fromISO(second.json().task.dueAt as string, { zone: 'utc' }).setZone(
      'Asia/Shanghai',
    );
    expect(fri.toISODate()).toBe('2026-03-13');
    expect(second.json().task.recurrenceDtstart).toBe(created.json().recurrenceDtstart);
  });

  it('PATCH dueAt snaps to next grid without moving dtstart', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: {
        title: 'Snap',
        listId: inbox,
        isAllDay: true,
        dueAt: shanghai('2026-03-09'),
        recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      },
    });
    const dtstart = created.json().recurrenceDtstart;
    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${created.json().id}`,
      token: alice.token,
      payload: { dueAt: shanghai('2026-03-10') },
    });
    expect(patched.statusCode).toBe(200);
    const due = DateTime.fromISO(patched.json().dueAt as string, { zone: 'utc' }).setZone(
      'Asia/Shanghai',
    );
    expect(due.toISODate()).toBe('2026-03-11');
    expect(patched.json().recurrenceDtstart).toBe(dtstart);
  });
});
