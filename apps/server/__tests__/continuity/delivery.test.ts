/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { processDueAgentJobs } from '../../src/agent/jobs.js';
import { buildFastify } from '../../src/app.js';
import { setContinuityEnabledForTest } from '../../src/continuity/flag.js';
import { reserveOrdinaryPush } from '../../src/continuity/delivery-policy.js';
import { enqueueContinuityRecompute } from '../../src/continuity/recompute-job.js';
import { getDb } from '../../src/db/index.js';
import {
  continuityContractRevisions,
  continuityEvidence,
  continuityExposures,
  continuityInterventions,
  notificationOutbox,
  users,
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

function shameCopy(text: string): boolean {
  return /连续失败|欠了两次|偷懒|刷视频/.test(text);
}

describe('continuity delivery', () => {
  it('two missed timed windows yield one open stall_adjust', async () => {
    const { alice, contractId } = await stallAlice();
    const rows = await getDb()
      .select()
      .from(continuityInterventions)
      .where(
        and(
          eq(continuityInterventions.contractId, contractId),
          eq(continuityInterventions.kind, 'stall_adjust'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('open');
    expect(rows[0]!.content.facts.join('')).toContain('没有记录');
    expect(shameCopy(JSON.stringify(rows[0]!.content))).toBe(false);
    expect(rows[0]!.content.primaryAction).toMatchObject({
      title: '打开教材读 10 分钟',
      durationMin: 10,
      completionStandard: '读完一页',
    });

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/continuity/interventions',
      token: alice.token,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0].id).toBe(rows[0]!.id);
    expect(listed.json().items[0].content.whyNow).toContain('没有记录');
  });

  it('self-report then recompute withdraws the stall candidate', async () => {
    const { alice, contractId } = await stallAlice();
    const [open] = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.contractId, contractId));
    expect(open!.status).toBe('open');

    await getDb().insert(continuityEvidence).values({
      id: randomUUID(),
      userId: alice.id,
      sourceType: 'self_report',
      actor: 'user',
      occurredAt: THURSDAY_SLOT,
      recordedAt: FRIDAY,
      body: { note: '已经做过' },
    });
    await recomputeAt(alice.id, contractId, FRIDAY);

    const [after] = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.id, open!.id));
    expect(after!.status).toBe('withdrawn');

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/continuity/interventions',
      token: alice.token,
    });
    expect(listed.json().items).toEqual([]);
  });

  it('seen twice does not duplicate today exposures', async () => {
    const { alice, contractId } = await stallAlice();
    const [row] = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.contractId, contractId));
    const first = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/continuity/interventions/${row!.id}/seen`,
      token: alice.token,
    });
    const second = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/continuity/interventions/${row!.id}/seen`,
      token: alice.token,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const seen = await getDb()
      .select()
      .from(continuityExposures)
      .where(
        and(
          eq(continuityExposures.candidateId, row!.id),
          eq(continuityExposures.surface, 'today'),
          isNotNull(continuityExposures.seenAt),
        ),
      );
    expect(seen).toHaveLength(1);
  });

  it('concurrent workers cannot reserve more than one ordinary push for the same local day', async () => {
    const alice = await registerUser(app, 'alice');
    const candidateId = randomUUID();
    const reserve = () =>
      getDb().transaction((tx) =>
        reserveOrdinaryPush(tx, {
          userId: alice.id,
          candidateId,
          now: FRIDAY,
          timezone: TZ,
          weekStartsOn: 1,
        }),
      );
    const results = await Promise.all([reserve(), reserve(), reserve()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const rows = await getDb()
      .select()
      .from(continuityExposures)
      .where(
        and(
          eq(continuityExposures.userId, alice.id),
          eq(continuityExposures.surface, 'push'),
          eq(continuityExposures.budgetClass, 'ordinary'),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('today seen cancels pending push and does not enqueue another', async () => {
    const { alice, contractId } = await stallAlice();
    const [row] = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.contractId, contractId));
    const pending = await getDb()
      .select()
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.eventType, 'agent.continuity'),
          eq(notificationOutbox.entityId, row!.id),
        ),
      );
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.some((item) => item.status === 'pending')).toBe(true);

    const seen = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/continuity/interventions/${row!.id}/seen`,
      token: alice.token,
    });
    expect(seen.statusCode).toBe(200);

    const afterSeen = await getDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.entityId, row!.id));
    expect(afterSeen.every((item) => item.status === 'cancelled')).toBe(true);

    await recomputeAt(alice.id, contractId, FRIDAY);
    const afterRecompute = await getDb()
      .select()
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.eventType, 'agent.continuity'),
          eq(notificationOutbox.entityId, row!.id),
          eq(notificationOutbox.status, 'pending'),
        ),
      );
    expect(afterRecompute).toHaveLength(0);
  });

  it('quiet hours delay outbox scheduledAt', async () => {
    const alice = await registerUser(app, 'alice');
    await getDb()
      .update(users)
      .set({ quietHoursStart: '19:00', quietHoursEnd: '08:00', timezone: TZ })
      .where(eq(users.id, alice.id));
    const outcomeId = await createOutcome(alice.token);
    const contract = await activateTimed(alice.token, outcomeId);
    await backdateActivation(contract.id);
    await recomputeAt(alice.id, contract.id, FRIDAY);

    const [job] = await getDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.eventType, 'agent.continuity'));
    expect(job).toBeTruthy();
    expect(job!.scheduledAt.getTime()).toBeGreaterThan(FRIDAY.getTime());
  });

  it('cross-user intervention routes 404 and list does not leak', async () => {
    const { alice, contractId } = await stallAlice();
    const bob = await registerUser(app, 'bob');
    const [row] = await getDb()
      .select()
      .from(continuityInterventions)
      .where(eq(continuityInterventions.contractId, contractId));

    const seen = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/continuity/interventions/${row!.id}/seen`,
      token: bob.token,
    });
    expect(seen.statusCode).toBe(404);

    const snooze = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/continuity/interventions/${row!.id}/snooze`,
      token: bob.token,
      payload: {},
    });
    expect(snooze.statusCode).toBe(404);

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/continuity/interventions',
      token: bob.token,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([]);

    const aliceList = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/continuity/interventions',
      token: alice.token,
    });
    expect(aliceList.json().items).toHaveLength(1);
  });
});
