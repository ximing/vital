import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { db } from '../src/db/index.js';
import { holidayCalendar } from '../src/db/schema.js';
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

  it('second complete of a COUNT-ended series is 409 not 500', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: {
        title: 'Once',
        listId: inbox,
        isAllDay: true,
        dueAt: shanghai('2026-03-09'),
        recurrence: 'FREQ=DAILY;COUNT=1',
      },
    });
    expect(created.statusCode).toBe(201);
    const first = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${created.json().id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().task.status).toBe('done');
    const second = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${created.json().id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('fixed legal-workday recurrence rolls one master task forward on complete', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    await db.insert(holidayCalendar).values({
      region: 'CN',
      date: '2026-02-21',
      kind: 'workday',
      sourceVersion: 'test',
    });
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: {
        title: '日报',
        listId: inbox,
        dueAt: '2026-02-20T09:00:00+08:00',
        timezone: 'Asia/Shanghai',
        recurrenceKind: 'legal_workdays',
      },
    });
    expect(created.statusCode).toBe(201);

    const completed = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${created.json().id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().task.id).toBe(created.json().id);
    expect(completed.json().task.status).toBe('todo');
    expect(completed.json().task.recurrenceKind).toBe('legal_workdays');
    expect(completed.json().task.dueAt).toBe('2026-02-21T01:00:00.000Z');
  });

  it('expands fixed recurrence into future calendar instances', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: {
        title: '晨间规划',
        listId: inbox,
        dueAt: '2026-09-07T09:00:00+08:00',
        timezone: 'Asia/Shanghai',
        recurrenceKind: 'daily',
      },
    });
    expect(created.statusCode).toBe(201);

    const calendar = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/tasks/calendar?from=2026-09-07T00:00:00.000Z&to=2026-09-09T23:59:59.000Z',
      token: alice.token,
    });
    expect(calendar.statusCode).toBe(200);
    expect(calendar.json().instances.map((item: { occurrenceAt: string }) => item.occurrenceAt)).toEqual([
      '2026-09-07T01:00:00.000Z',
      '2026-09-08T01:00:00.000Z',
      '2026-09-09T01:00:00.000Z',
    ]);
  });
});
