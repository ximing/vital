/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { processDueAgentJobs } from '../../src/agent/jobs.js';
import { buildFastify } from '../../src/app.js';
import { setContinuityEnabledForTest } from '../../src/continuity/flag.js';
import { enqueueContinuityRecompute } from '../../src/continuity/recompute-job.js';
import {
  evaluateWorkRisk,
  occupancyFromTask,
  WORK_RISK_UNCONFIRMED,
} from '../../src/continuity/rules/work-risk.js';
import { getDb } from '../../src/db/index.js';
import { continuityDependencies, continuityInterventions } from '../../src/db/schema.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { inboxId, registerUser } from '../helpers/session.js';

const TZ = 'Asia/Shanghai';
const WORK = { startHm: '09:00', endHm: '18:00' };

function shanghai(iso: string): Date {
  return DateTime.fromISO(iso, { zone: TZ }).toJSDate();
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  setContinuityEnabledForTest(true);
});

afterEach(() => {
  setContinuityEnabledForTest(null);
});

afterAll(async () => {
  await app.close();
});

async function createOutcome(token: string, name = '验收'): Promise<string> {
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/outcomes',
    token,
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

async function activate(token: string, outcomeId: string): Promise<{ id: string }> {
  const res = await injectJson(app, {
    method: 'POST',
    url: `/api/v1/outcomes/${outcomeId}/continuity/activate`,
    token,
    payload: {},
  });
  expect(res.statusCode).toBe(200);
  return res.json().contract as { id: string };
}

async function createTask(
  token: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; undo?: { completionId: string } }> {
  const listId = await inboxId(app, token);
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/tasks',
    token,
    payload: { listId, timezone: TZ, isAllDay: false, ...payload },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

async function recomputeAt(userId: string, contractId: string, now: Date): Promise<void> {
  await enqueueContinuityRecompute(getDb(), userId, contractId, now);
  await processDueAgentJobs(new Date(now.getTime() + 1_000));
}

describe('evaluateWorkRisk', () => {
  const due = shanghai('2026-10-30T18:00:00');
  const nowMorning = shanghai('2026-10-30T10:00:00');

  it('without estimate is unconfirmed and never says 延期', () => {
    const decision = evaluateWorkRisk({
      remainingMinutes: null,
      dueAt: due,
      workHours: WORK,
      timezone: TZ,
      occupancy: [],
      protectedBlocks: [],
      openDependencies: [],
      splitAllowed: false,
      now: nowMorning,
    });
    expect(decision.kind).toBe('unconfirmed');
    expect(decision.missing).toContain('estimate');
    expect(decision.whyNow).toBe(WORK_RISK_UNCONFIRMED);
    expect(JSON.stringify(decision)).not.toMatch(/延期/);
  });

  it('with estimate, due, and free slots computes latestStartAt', () => {
    const decision = evaluateWorkRisk({
      remainingMinutes: 120,
      dueAt: due,
      workHours: WORK,
      timezone: TZ,
      occupancy: [],
      protectedBlocks: [],
      openDependencies: [],
      splitAllowed: false,
      now: nowMorning,
    });
    expect(decision.kind).toBe('risk');
    expect(decision.latestStartAt?.toISOString()).toBe(shanghai('2026-10-30T16:00:00').toISOString());
    expect(decision.whyNow).toContain('最晚窗口');
    expect(decision.whyNow).not.toMatch(/延期/);
  });

  it('does not let B reuse a slot already occupied by A', () => {
    const occupied = {
      start: shanghai('2026-10-30T17:00:00'),
      end: shanghai('2026-10-30T18:00:00'),
    };
    const withA = evaluateWorkRisk({
      remainingMinutes: 60,
      dueAt: due,
      workHours: WORK,
      timezone: TZ,
      occupancy: [],
      protectedBlocks: [],
      openDependencies: [],
      splitAllowed: false,
      now: nowMorning,
    });
    const withB = evaluateWorkRisk({
      remainingMinutes: 60,
      dueAt: due,
      workHours: WORK,
      timezone: TZ,
      occupancy: [occupied],
      protectedBlocks: [],
      openDependencies: [],
      splitAllowed: false,
      now: nowMorning,
    });
    expect(withA.latestStartAt?.toISOString()).toBe(shanghai('2026-10-30T17:00:00').toISOString());
    expect(withB.latestStartAt?.toISOString()).toBe(shanghai('2026-10-30T16:00:00').toISOString());
  });

  it('all-day protection occupies the work window; all-day due tasks do not', () => {
    const fridayDue = shanghai('2026-10-30T18:00:00');
    const protectedOnce = evaluateWorkRisk({
      remainingMinutes: 60,
      dueAt: fridayDue,
      workHours: WORK,
      timezone: TZ,
      occupancy: [],
      protectedBlocks: [
        {
          kind: 'once',
          timezone: TZ,
          startAt: shanghai('2026-10-30T00:00:00'),
          endAt: shanghai('2026-10-31T00:00:00'),
          weekday: null,
          startHm: null,
          endHm: null,
        },
      ],
      openDependencies: [],
      splitAllowed: false,
      now: shanghai('2026-10-29T10:00:00'),
    });
    expect(protectedOnce.latestStartAt?.toISOString()).toBe(
      shanghai('2026-10-29T17:00:00').toISOString(),
    );

    expect(
      occupancyFromTask({
        isAllDay: true,
        startAt: shanghai('2026-10-30T00:00:00'),
        dueAt: shanghai('2026-10-30T00:00:00'),
        calendarEndAt: null,
      }),
    ).toBeNull();

    const allDayDueOccupancy = occupancyFromTask({
      isAllDay: true,
      startAt: shanghai('2026-10-30T00:00:00'),
      dueAt: shanghai('2026-10-30T00:00:00'),
      calendarEndAt: null,
    });
    const withAllDayDue = evaluateWorkRisk({
      remainingMinutes: 60,
      dueAt: fridayDue,
      workHours: WORK,
      timezone: TZ,
      occupancy: allDayDueOccupancy ? [allDayDueOccupancy] : [],
      protectedBlocks: [],
      openDependencies: [],
      splitAllowed: false,
      now: nowMorning,
    });
    expect(withAllDayDue.latestStartAt?.toISOString()).toBe(
      shanghai('2026-10-30T17:00:00').toISOString(),
    );
  });
});

describe('continuity dependencies and work-risk', () => {
  it('resolves an internal dep on complete and reopens on uncomplete', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token);
    await activate(alice.token, outcomeId);
    const prereq = await createTask(alice.token, { title: '接口就绪', outcomeId });
    const add = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/continuity/dependencies`,
      token: alice.token,
      payload: { prerequisiteType: 'task', prerequisiteId: prereq.id },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().status).toBe('open');
    const depId = add.json().id as string;

    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${prereq.id}/complete`,
      token: alice.token,
    });
    expect(done.statusCode).toBe(200);
    const [resolved] = await getDb()
      .select()
      .from(continuityDependencies)
      .where(eq(continuityDependencies.id, depId));
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedAt).not.toBeNull();

    const completionId = done.json().undo.completionId as string;
    const undone = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${prereq.id}/uncomplete`,
      token: alice.token,
      payload: { completionId },
    });
    expect(undone.statusCode).toBe(200);
    const [reopened] = await getDb()
      .select()
      .from(continuityDependencies)
      .where(eq(continuityDependencies.id, depId));
    expect(reopened?.status).toBe('open');
    expect(reopened?.resolvedAt).toBeNull();
  });

  it('rejects a self-loop and a cycle', async () => {
    const alice = await registerUser(app, 'alice');
    const a = await createOutcome(alice.token, '事项A');
    const b = await createOutcome(alice.token, '事项B');
    await activate(alice.token, a);
    await activate(alice.token, b);

    const loop = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${a}/continuity/dependencies`,
      token: alice.token,
      payload: { prerequisiteType: 'outcome', prerequisiteId: a },
    });
    expect(loop.statusCode).toBe(400);

    const ab = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${a}/continuity/dependencies`,
      token: alice.token,
      payload: { prerequisiteType: 'outcome', prerequisiteId: b },
    });
    expect(ab.statusCode).toBe(200);

    const ba = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${b}/continuity/dependencies`,
      token: alice.token,
      payload: { prerequisiteType: 'outcome', prerequisiteId: a },
    });
    expect(ba.statusCode).toBe(400);
  });

  it('returns 404 across users', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const outcomeId = await createOutcome(alice.token);
    await activate(alice.token, outcomeId);
    const created = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/continuity/dependencies`,
      token: alice.token,
      payload: { prerequisiteType: 'external', externalLabel: '等对方回邮件' },
    });
    expect(created.statusCode).toBe(200);
    const depId = created.json().id as string;

    const get = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${outcomeId}/continuity/dependencies`,
      token: bob.token,
    });
    expect(get.statusCode).toBe(404);

    const patch = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/continuity/dependencies/${depId}`,
      token: bob.token,
      payload: { status: 'resolved' },
    });
    expect(patch.statusCode).toBe(404);

    const block = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/protected-blocks',
      token: alice.token,
      payload: {
        kind: 'once',
        label: '家庭',
        startAt: shanghai('2026-10-31T00:00:00').toISOString(),
        endAt: shanghai('2026-11-01T00:00:00').toISOString(),
      },
    });
    expect(block.statusCode).toBe(200);
    const bobPatch = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/continuity/protected-blocks/${block.json().id as string}`,
      token: bob.token,
      payload: { label: '休息' },
    });
    expect(bobPatch.statusCode).toBe(404);
  });

  it('withdraws work_risk after remaining work is done', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token);
    const contract = await activate(alice.token, outcomeId);
    const due = shanghai('2026-10-30T18:00:00');
    const now = shanghai('2026-10-30T10:00:00');
    const remaining = await createTask(alice.token, {
      title: '写验收说明',
      outcomeId,
      estimateMinutes: 120,
      dueAt: due.toISOString(),
    });

    await recomputeAt(alice.id, contract.id, now);
    const open = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.contractId, contract.id));
    const risk = open.filter((row) => row.kind === 'work_risk' && row.status === 'open');
    expect(risk.length).toBe(1);
    expect(JSON.stringify(risk[0]!.content)).not.toMatch(/延期/);
    expect(risk[0]!.content.whyNow).toContain('最晚窗口');

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/continuity/interventions',
      token: alice.token,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0].kind).toBe('work_risk');

    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${remaining.id}/complete`,
      token: alice.token,
    });
    expect(done.statusCode).toBe(200);
    await processDueAgentJobs(new Date(Date.now() + 2_000));

    const after = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.contractId, contract.id));
    expect(after.filter((row) => row.kind === 'work_risk' && row.status === 'open')).toHaveLength(0);
    expect(after.some((row) => row.kind === 'work_risk' && row.status === 'withdrawn')).toBe(true);
  });
});
