/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { processDueAgentJobs } from '../../src/agent/jobs.js';
import { isMemorySuppressed, memoryEvidenceFingerprint, memoryTopicFingerprint } from '../../src/continuity/memory-suppress.js';
import { buildFastify } from '../../src/app.js';
import { setContinuityEnabledForTest } from '../../src/continuity/flag.js';
import { enqueueContinuityRecompute } from '../../src/continuity/recompute-job.js';
import { getDb } from '../../src/db/index.js';
import {
  continuityContractRevisions,
  continuityEvidence,
  continuityExperiments,
  continuityInterventions,
  continuityMemorySuppressions,
  tasks,
} from '../../src/db/schema.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

const TZ = 'Asia/Shanghai';
const MONDAY = DateTime.fromISO('2026-10-26T00:00:00', { zone: TZ }).toJSDate();
const FRIDAY = DateTime.fromISO('2026-10-30T20:00:00', { zone: TZ }).toJSDate();
const THURSDAY_SLOT = DateTime.fromISO('2026-10-29T20:30:00', { zone: TZ }).toJSDate();

const TIMED_ACTIVATE = {
  timezone: TZ,
  weekStartsOn: 1 as const,
  cadence: {
    kind: 'timed' as const,
    slots: [
      { weekday: 2, startHm: '20:00', durationMin: 60 },
      { weekday: 4, startHm: '20:00', durationMin: 60 },
    ],
    graceHours: 12,
  },
  minAction: {
    title: '打开教材读 10 分钟',
    durationMin: 10,
    completionStandard: '读完一页',
  },
};

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

async function createOutcome(token: string, name = '英语学习'): Promise<string> {
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/outcomes',
    token,
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

async function activateTimed(token: string, outcomeId: string): Promise<{ id: string }> {
  const res = await injectJson(app, {
    method: 'POST',
    url: `/api/v1/outcomes/${outcomeId}/continuity/activate`,
    token,
    payload: TIMED_ACTIVATE,
  });
  expect(res.statusCode).toBe(200);
  return res.json().contract as { id: string };
}

async function backdateActivation(contractId: string): Promise<void> {
  await getDb()
    .update(continuityContractRevisions)
    .set({ activatedAt: MONDAY })
    .where(eq(continuityContractRevisions.contractId, contractId));
}

async function recomputeAt(userId: string, contractId: string, now: Date): Promise<void> {
  await enqueueContinuityRecompute(getDb(), userId, contractId, now);
  await processDueAgentJobs(new Date(now.getTime() + 1_000));
}

async function stallAlice() {
  const alice = await registerUser(app, 'alice');
  const outcomeId = await createOutcome(alice.token);
  const contract = await activateTimed(alice.token, outcomeId);
  await backdateActivation(contract.id);
  await recomputeAt(alice.id, contract.id, FRIDAY);
  return { alice, outcomeId, contractId: contract.id };
}

describe('continuity experiments', () => {
  it('self-report then recompute withdraws stall and does not create tasks', async () => {
    const { alice, contractId } = await stallAlice();
    const [open] = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.contractId, contractId));
    expect(open!.status).toBe('open');

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/evidence',
      token: alice.token,
      payload: {
        contractId,
        body: '周四已经练过了',
        occurredAt: THURSDAY_SLOT.toISOString(),
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().sourceType).toBe('self_report');
    expect(created.json().actor).toBe('user');
    expect(created.json().body).toBe('周四已经练过了');
    expect(created.json().contractId).toBe(contractId);

    const taskRows = await getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, alice.id));
    expect(taskRows).toHaveLength(0);

    await recomputeAt(alice.id, contractId, FRIDAY);
    const [after] = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.id, open!.id));
    expect(after!.status).toBe('withdrawn');
  });

  it('feedback done writes self_report and withdraws stall after recompute', async () => {
    const { alice, contractId } = await stallAlice();
    const [open] = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.contractId, contractId));

    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/continuity/interventions/${open!.id}/feedback`,
      token: alice.token,
      payload: { kind: 'done', body: '已经做过' },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe('resolved');

    const evidence = await getDb()
      .select()
      .from(continuityEvidence)
      .where(eq(continuityEvidence.userId, alice.id));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.sourceType).toBe('self_report');
    expect(evidence[0]!.actor).toBe('user');

    await recomputeAt(alice.id, contractId, FRIDAY);
    const [after] = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.id, open!.id));
    expect(after!.status).toBe('resolved');

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/continuity/interventions',
      token: alice.token,
    });
    expect(listed.json().items).toEqual([]);
  });

  it('duplicate evidence idempotencyKey replays the original row', async () => {
    const { alice, contractId } = await stallAlice();
    const payload = {
      contractId,
      body: '补记一次',
      occurredAt: THURSDAY_SLOT.toISOString(),
      idempotencyKey: 'evidence-key-1',
    };
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/evidence',
      token: alice.token,
      payload,
    });
    const second = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/evidence',
      token: alice.token,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);

    const rows = await getDb()
      .select()
      .from(continuityEvidence)
      .where(eq(continuityEvidence.userId, alice.id));
    expect(rows).toHaveLength(1);
  });

  it('rejects a second active experiment on the same contract', async () => {
    const { alice, contractId } = await stallAlice();
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/experiments',
      token: alice.token,
      payload: { contractId, hypothesis: '先试减量' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('active');
    expect(first.json().beforeRevision).toBe(first.json().afterRevision);

    const second = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/experiments',
      token: alice.token,
      payload: { contractId, hypothesis: '再试一次' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CONTINUITY_EXPERIMENT_ACTIVE');

    const rows = await getDb()
      .select()
      .from(continuityExperiments)
      .where(eq(continuityExperiments.contractId, contractId));
    expect(rows).toHaveLength(1);
  });

  it('pause interrupts an active experiment', async () => {
    const { alice, outcomeId, contractId } = await stallAlice();
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/experiments',
      token: alice.token,
      payload: { contractId },
    });
    expect(created.statusCode).toBe(200);

    const paused = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/continuity/pause`,
      token: alice.token,
      payload: {},
    });
    expect(paused.statusCode).toBe(200);

    const [row] = await getDb()
      .select()
      .from(continuityExperiments)
      .where(eq(continuityExperiments.id, created.json().id as string));
    expect(row!.status).toBe('interrupted');
  });

  it('adjust supersedes the previous experiment and writes a new revision when cadence changes', async () => {
    const { alice, contractId } = await stallAlice();
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/experiments',
      token: alice.token,
      payload: { contractId, hypothesis: '先观察' },
    });
    expect(first.statusCode).toBe(200);
    const firstId = first.json().id as string;

    const [open] = await getDb()
      .select()
      .from(continuityInterventions)
      .where(
        and(
          eq(continuityInterventions.contractId, contractId),
          eq(continuityInterventions.status, 'open'),
        ),
      );
    expect(open).toBeTruthy();

    const adjust = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/continuity/interventions/${open!.id}/feedback`,
      token: alice.token,
      payload: {
        kind: 'adjust',
        hypothesis: '改成每周一次',
        cadence: { kind: 'weekly_count', count: 1, durationMin: 15, graceHours: 12 },
        minAction: { title: '打开教材 5 分钟', durationMin: 5, completionStandard: '读完半页' },
      },
    });
    expect(adjust.statusCode).toBe(200);
    expect(adjust.json().status).toBe('accepted');

    const rows = await getDb()
      .select()
      .from(continuityExperiments)
      .where(eq(continuityExperiments.contractId, contractId));
    expect(rows).toHaveLength(2);
    const previous = rows.find((row) => row.id === firstId);
    const next = rows.find((row) => row.id !== firstId);
    expect(previous!.status).toBe('superseded');
    expect(next!.status).toBe('active');
    expect(next!.afterRevision).toBeGreaterThan(next!.beforeRevision);

    const got = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/continuity/experiments/${next!.id}`,
      token: alice.token,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().goal.cadence).toMatchObject({ kind: 'weekly_count', count: 1 });
    expect(got.json().baseline.incomparable).toBe(false);
  });

  it('delete memory writes a suppression row', async () => {
    const alice = await registerUser(app, 'alice');
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/memory',
      token: alice.token,
      payload: { kind: 'pattern', content: '午休短练习更容易开始', scope: ['all'] },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const deleted = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/agent/memory/${id}`,
      token: alice.token,
    });
    expect(deleted.statusCode).toBe(204);

    const rows = await getDb()
      .select()
      .from(continuityMemorySuppressions)
      .where(eq(continuityMemorySuppressions.userId, alice.id));
    expect(rows).toHaveLength(1);
    const topic = memoryTopicFingerprint('pattern', '午休短练习更容易开始');
    const evidence = memoryEvidenceFingerprint([], '午休短练习更容易开始');
    expect(rows[0]!.topicFingerprint).toBe(topic);
    expect(rows[0]!.evidenceFingerprint).toBe(evidence);
    expect(await isMemorySuppressed(alice.id, topic, evidence)).toBe(true);
  });

  it('cross-user evidence and experiment routes 404', async () => {
    const { alice, contractId } = await stallAlice();
    const bob = await registerUser(app, 'bob');
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/experiments',
      token: alice.token,
      payload: { contractId },
    });
    expect(created.statusCode).toBe(200);
    const experimentId = created.json().id as string;

    const evidence = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/evidence',
      token: alice.token,
      payload: { contractId, body: 'alice 的补记', occurredAt: THURSDAY_SLOT.toISOString() },
    });
    expect(evidence.statusCode).toBe(200);
    const evidenceId = evidence.json().id as string;

    const bobEvidence = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/evidence',
      token: bob.token,
      payload: { contractId, body: 'bob 试图补记' },
    });
    expect(bobEvidence.statusCode).toBe(404);

    const bobPatch = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/continuity/evidence/${evidenceId}`,
      token: bob.token,
      payload: { body: '篡改' },
    });
    expect(bobPatch.statusCode).toBe(404);

    const bobDelete = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/continuity/evidence/${evidenceId}`,
      token: bob.token,
    });
    expect(bobDelete.statusCode).toBe(404);

    const bobGet = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/continuity/experiments/${experimentId}`,
      token: bob.token,
    });
    expect(bobGet.statusCode).toBe(404);

    const bobCreate = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/experiments',
      token: bob.token,
      payload: { contractId },
    });
    expect(bobCreate.statusCode).toBe(404);
  });

  it('recompute marks an experiment review_ready after windowEnd; later evidence bumps reviewVersion', async () => {
    const { alice, contractId } = await stallAlice();
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/experiments',
      token: alice.token,
      payload: { contractId, hypothesis: '观察一周' },
    });
    expect(created.statusCode).toBe(200);
    const experimentId = created.json().id as string;

    await getDb()
      .update(continuityExperiments)
      .set({ windowStart: MONDAY, windowEnd: new Date(FRIDAY.getTime() - 1_000) })
      .where(eq(continuityExperiments.id, experimentId));
    await recomputeAt(alice.id, contractId, FRIDAY);

    const ready = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/continuity/experiments/${experimentId}`,
      token: alice.token,
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().status).toBe('review_ready');
    expect(ready.json().review).toMatchObject({
      actualProgress: expect.any(Number),
      insufficientData: expect.any(Boolean),
    });
    const originalReview = ready.json().review;
    const originalVersion = ready.json().reviewVersion as number;

    const logged = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/evidence',
      token: alice.token,
      payload: {
        contractId,
        body: '窗口内补记',
        occurredAt: THURSDAY_SLOT.toISOString(),
      },
    });
    expect(logged.statusCode).toBe(200);
    await recomputeAt(alice.id, contractId, FRIDAY);

    const bumped = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/continuity/experiments/${experimentId}`,
      token: alice.token,
    });
    expect(bumped.json().status).toBe('review_ready');
    expect(bumped.json().review).toEqual(originalReview);
    expect(bumped.json().reviewVersion).toBeGreaterThan(originalVersion);
  });
});
