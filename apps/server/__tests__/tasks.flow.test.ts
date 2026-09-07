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

function shanghaiDate(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: 'Asia/Shanghai' }).startOf('day').toUTC().toISO() ?? '';
}

describe('tasks', () => {
  it('Today includes overdue open tasks', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const yesterday = DateTime.now().setZone('Asia/Shanghai').minus({ days: 1 }).toISODate();
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: {
        title: 'Overdue',
        listId: inbox,
        dueAt: shanghaiDate(yesterday ?? '2026-01-01'),
        isAllDay: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const today = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/tasks?listId=smart:today',
      token: alice.token,
    });
    expect(today.statusCode).toBe(200);
    const ids = (today.json().items as { id: string }[]).map((t) => t.id);
    expect(ids).toContain(created.json().id);
  });

  it('uncomplete undated non-recurring restores due_at null', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Someday maybe', listId: inbox },
    });
    expect(created.json().dueAt).toBeNull();
    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${created.json().id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().undo.completionId).toBeTruthy();
    expect(done.json().task.status).toBe('done');
    const undone = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${created.json().id}/uncomplete`,
      token: alice.token,
      payload: { completionId: done.json().undo.completionId },
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().dueAt).toBeNull();
    expect(undone.json().status).toBe('todo');
    expect(undone.json().timeBucket).not.toBe('dated');
  });

  it('complete without dueAt still returns completionId', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'No date', listId: inbox },
    });
    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${created.json().id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(typeof done.json().undo.completionId).toBe('string');
    expect(done.json().undo.completionId.length).toBeGreaterThan(0);
  });

  it('restore parent brings back cascaded children', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const parent = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Parent', listId: inbox },
    });
    const child = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Child', listId: inbox, parentId: parent.json().id },
    });
    expect(child.statusCode).toBe(201);
    const del = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/tasks/${parent.json().id}`,
      token: alice.token,
    });
    expect(del.statusCode).toBe(204);
    const missing = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks/${child.json().id}`,
      token: alice.token,
    });
    expect(missing.statusCode).toBe(404);
    const restored = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${parent.json().id}/restore`,
      token: alice.token,
      payload: {},
    });
    expect(restored.statusCode).toBe(200);
    const childBack = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks/${child.json().id}`,
      token: alice.token,
    });
    expect(childBack.statusCode).toBe(200);
    expect(childBack.json().deletedAt).toBeNull();
  });

  it('subtasks inherit list_id; parent move moves children; child listId rejected', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const other = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/lists',
      token: alice.token,
      payload: { name: 'Other' },
    });
    const parent = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'P', listId: inbox },
    });
    const child = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'C', listId: inbox, parentId: parent.json().id },
    });
    expect(child.json().listId).toBe(inbox);
    const moved = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${parent.json().id}`,
      token: alice.token,
      payload: { listId: other.json().id },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().listId).toBe(other.json().id);
    const childAfter = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks/${child.json().id}`,
      token: alice.token,
    });
    expect(childAfter.json().listId).toBe(other.json().id);
    const reject = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${child.json().id}`,
      token: alice.token,
      payload: { listId: inbox },
    });
    expect(reject.statusCode).toBe(400);
  });

  it('timeBucket someday write and recurrence requires dueAt', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const someday = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Later', listId: inbox, timeBucket: 'someday' },
    });
    expect(someday.json().timeBucket).toBe('someday');
    const noDue = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Repeat', listId: inbox, recurrence: 'FREQ=DAILY' },
    });
    expect(noDue.statusCode).toBe(400);
    expect(noDue.json().error.code).toBe('RRULE_DUE_REQUIRED');
  });

  it('persists semantic reminders and fixed recurrence', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: {
        title: '发送周报',
        listId: inbox,
        dueAt: '2026-09-08T09:00:00+08:00',
        reminderMode: 'offset',
        reminderOffsetMinutes: 15,
        recurrenceKind: 'legal_workdays',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      reminderMode: 'offset',
      reminderOffsetMinutes: 15,
      reminderAt: null,
      recurrenceKind: 'legal_workdays',
      recurrence: null,
    });
  });
});
