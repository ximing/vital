/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { DateTime } from 'luxon';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { getDb } from '../src/db/index.js';
import { agentJobs } from '../src/db/schema.js';
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

  it('persists pinned on roots and rejects pinning a subtask', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Pin me', listId: inbox, pinned: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().pinned).toBe(true);
    const cleared = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${created.json().id}`,
      token: alice.token,
      payload: { pinned: false },
    });
    expect(cleared.json().pinned).toBe(false);
    const pinned = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${created.json().id}`,
      token: alice.token,
      payload: { pinned: true },
    });
    expect(pinned.statusCode).toBe(200);
    expect(pinned.json().pinned).toBe(true);
    const listed = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks?listId=${inbox}`,
      token: alice.token,
    });
    expect(
      (listed.json().items as { id: string; pinned: boolean }[]).find(
        (task) => task.id === created.json().id,
      )?.pinned,
    ).toBe(true);
    const child = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Child', listId: inbox, parentId: created.json().id, pinned: true },
    });
    expect(child.statusCode).toBe(400);
    const sub = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Child', listId: inbox, parentId: created.json().id },
    });
    expect(sub.statusCode).toBe(201);
    const pinChild = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${sub.json().id}`,
      token: alice.token,
      payload: { pinned: true },
    });
    expect(pinChild.statusCode).toBe(400);
  });

  it('undated tasks land in the someday list and recurrence requires dueAt', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Later', listId: inbox },
    });
    expect(created.statusCode).toBe(201);
    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/tasks?listId=smart:someday',
      token: alice.token,
    });
    expect(listed.json().items.map((task: { id: string }) => task.id)).toContain(
      created.json().id,
    );
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

  it('accepts on-time and offset reminders on all-day dated tasks', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const dueAt = shanghaiDate('2026-09-08');
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: {
        title: '全天截止',
        listId: inbox,
        dueAt,
        isAllDay: true,
        reminderMode: 'due',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ isAllDay: true, reminderMode: 'due' });
    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${created.json().id as string}`,
      token: alice.token,
      payload: { reminderMode: 'offset', reminderOffsetMinutes: 1440 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      reminderMode: 'offset',
      reminderOffsetMinutes: 1440,
    });
  });

  it('counts open tasks per list and smart list', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const yesterday = DateTime.now().setZone('Asia/Shanghai').minus({ days: 1 }).toISODate();
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Plain', listId: inbox },
    });
    await injectJson(app, {
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
    const done = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Finished', listId: inbox },
    });
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${done.json().id as string}/complete`,
      token: alice.token,
      payload: {},
    });
    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/tasks/counts',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const counts = res.json().counts as Record<string, number>;
    expect(counts[inbox]).toBe(2);
    expect(counts['smart:inbox']).toBe(2);
    expect(counts['smart:today']).toBe(1);
  });

  it('listing a parent list includes tasks from child lists', async () => {
    const alice = await registerUser(app);
    const parent = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/lists',
      token: alice.token,
      payload: { name: '父' },
    });
    const child = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/lists',
      token: alice.token,
      payload: { name: '子', parentId: parent.json().id },
    });
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '父任务', listId: parent.json().id },
    });
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '子任务', listId: child.json().id },
    });
    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks?listId=${parent.json().id}`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const titles = (res.json().items as { title: string }[]).map((item) => item.title);
    expect(titles).toEqual(expect.arrayContaining(['父任务', '子任务']));
    const childOnly = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks?listId=${child.json().id}`,
      token: alice.token,
    });
    expect((childOnly.json().items as { title: string }[]).map((item) => item.title)).toEqual(['子任务']);
  });
});

describe('tasks agent triggers', () => {
  it('pushing dueAt forward increments defer_count (other edits do not); 3rd defer enqueues task.decompose once', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: {
        title: '写年度总结',
        listId: inbox,
        dueAt: shanghaiDate('2026-10-01'),
        isAllDay: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as string;
    expect(created.json().deferCount).toBe(0);

    const pushDue = async (date: string) =>
      injectJson(app, {
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId}`,
        token: alice.token,
        payload: { dueAt: shanghaiDate(date) },
      });

    expect((await pushDue('2026-10-02')).json().deferCount).toBe(1);

    // A non-due edit must not bump defer_count.
    const renamed = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { title: '写年度总结（草稿）' },
    });
    expect(renamed.json().deferCount).toBe(1);

    expect((await pushDue('2026-10-03')).json().deferCount).toBe(2);
    expect((await pushDue('2026-10-04')).json().deferCount).toBe(3);

    const decomposeJobs = async () =>
      getDb()
        .select()
        .from(agentJobs)
        .where(and(eq(agentJobs.userId, alice.id), eq(agentJobs.jobType, 'task.decompose')));

    let jobs = await decomposeJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toEqual({ taskId });
    expect(jobs[0]!.status).toBe('pending');

    // A 4th defer while the proposal is pending must not enqueue a duplicate.
    expect((await pushDue('2026-10-05')).json().deferCount).toBe(4);
    jobs = await decomposeJobs();
    expect(jobs).toHaveLength(1);
  });

  it('assigning outcomeId on create enqueues an outcome.refresh job', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const outcome = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/outcomes',
      token: alice.token,
      payload: { name: '健身' },
    });
    expect(outcome.statusCode).toBe(200);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '跑步 5 公里', listId: inbox, outcomeId: outcome.json().id },
    });
    expect(created.statusCode).toBe(201);
    const jobs = await getDb()
      .select()
      .from(agentJobs)
      .where(and(eq(agentJobs.userId, alice.id), eq(agentJobs.jobType, 'outcome.refresh')));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toEqual({ outcomeId: outcome.json().id });
  });
});
