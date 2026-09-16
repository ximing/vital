import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { dispatchAgentSchedule, finishAgentSchedule, markAgentSchedule } from '../../src/agent/scheduling.js';
import { runAgentScheduler } from '../../src/agent/scheduler.js';
import { getDb } from '../../src/db/index.js';
import {
  agentActions,
  agentEditEvents,
  agentJobs,
  agentMemory,
  agentScheduling,
} from '../../src/db/schema.js';
import { resetDb } from '../helpers/db.js';
import { inboxId, registerUser } from '../helpers/session.js';
import { injectJson } from '../helpers/http.js';

let app: FastifyInstance;
beforeAll(async () => { app = await buildFastify(); });
beforeEach(resetDb);
afterAll(async () => { await app.close(); });
const now = new Date('2026-09-10T00:00:00Z');

it('retains events arriving during a run and persists the successful cooldown', async () => {
  const user = await registerUser(app);
  const db = getDb();
  await db.transaction(tx => markAgentSchedule(tx, user.id, 'memory.distill', { now, urgent: true }));
  await db.transaction(tx => markAgentSchedule(tx, user.id, 'memory.distill', { now: new Date(+now + 1000) }));
  await db.transaction(tx => finishAgentSchedule(tx, user.id, 'memory.distill', 1, now));
  const [state] = await db.select().from(agentScheduling).where(eq(agentScheduling.userId, user.id));
  expect(state).toMatchObject({ generation: 2, processedGeneration: 1 });
  expect(state?.dueAt).toEqual(new Date(+now + 1_800_000));
  expect(await dispatchAgentSchedule(user.id, 'memory.distill', new Date(+now + 1_799_999))).toBeNull();
  expect(await dispatchAgentSchedule(user.id, 'memory.distill', new Date(+now + 1_800_000))).toBeTruthy();
});

it('rolls back dirty state together with the mutation', async () => {
  const user = await registerUser(app);
  await expect(getDb().transaction(async tx => {
    await markAgentSchedule(tx, user.id, 'outcome.cluster', { now });
    throw new Error('rollback');
  })).rejects.toThrow('rollback');
  expect(await getDb().select().from(agentScheduling).where(eq(agentScheduling.userId, user.id))).toEqual([]);
});

it('requires four eligible tasks, isolates users and does not extend a queued deadline', async () => {
  const a = await registerUser(app, 'a');
  const b = await registerUser(app, 'b');
  const listId = await inboxId(app, a.token);
  for (let i = 0; i < 4; i++) {
    const res = await injectJson(app, { method: 'POST', url: '/api/v1/tasks', token: a.token, payload: { title: `task ${i}`, listId } });
    expect(res.statusCode).toBe(201);
  }
  await getDb().transaction(tx => markAgentSchedule(tx, b.id, 'outcome.cluster', { now }));
  const due = new Date(Date.now() + 121_000);
  expect(await dispatchAgentSchedule(b.id, 'outcome.cluster', due)).toBeNull();
  const id = await dispatchAgentSchedule(a.id, 'outcome.cluster', due);
  expect(id).toBeTruthy();
  expect(await dispatchAgentSchedule(a.id, 'outcome.cluster', new Date(+due + 1000))).toBeNull();
  const [job] = await getDb().select().from(agentJobs).where(and(eq(agentJobs.userId, a.id), eq(agentJobs.jobType, 'outcome.cluster')));
  expect(job?.scheduledAt).toEqual(due);
});

it('reconciles an inactive user with old proposal but recent feedback', async () => {
  const user = await registerUser(app);
  await getDb().insert(agentActions).values({ id: randomUUID(), userId: user.id, actionType: 'outcome.create', targetType: 'outcome', targetId: randomUUID(), payload: {}, feedback: 'dismissed', feedbackAt: new Date(+now - 600_000), createdAt: new Date(+now - 30 * 86_400_000) });
  await runAgentScheduler(now);
  const [job] = await getDb().select().from(agentJobs).where(and(eq(agentJobs.userId, user.id), eq(agentJobs.jobType, 'memory.distill')));
  expect(job).toBeDefined();
  expect(job?.payload).toMatchObject({ mode: 'incremental', scheduleGeneration: 1 });
});

it('batches mixed-user signals into the same enqueue decisions', async () => {
  const active = await registerUser(app, 'active');
  const feedback = await registerUser(app, 'feedback');
  const editor = await registerUser(app, 'editor');
  const idle = await registerUser(app, 'idle');
  const maint = await registerUser(app, 'maint');
  const consumed = await registerUser(app, 'consumed');

  const listId = await inboxId(app, active.token);
  const created = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/tasks',
    token: active.token,
    payload: { title: '保持活跃', listId },
  });
  expect(created.statusCode).toBe(201);

  const feedbackAt = new Date(+now - 600_000);
  await getDb().insert(agentActions).values({
    id: randomUUID(),
    userId: feedback.id,
    actionType: 'outcome.create',
    targetType: 'outcome',
    targetId: randomUUID(),
    payload: {},
    feedback: 'dismissed',
    feedbackAt,
    createdAt: new Date(+now - 30 * 86_400_000),
  });

  await getDb().insert(agentEditEvents).values({
    id: randomUUID(),
    userId: editor.id,
    entityType: 'task',
    entityId: randomUUID(),
    fields: [{ field: 'title', before: '旧', after: '新' }],
    createdAt: new Date(+now - 600_000),
  });

  await getDb().insert(agentMemory).values({
    id: randomUUID(),
    userId: maint.id,
    kind: 'pattern',
    content: '站会先说阻塞',
    updatedAt: now,
  });

  const consumedActionId = randomUUID();
  await getDb().insert(agentActions).values({
    id: consumedActionId,
    userId: consumed.id,
    actionType: 'outcome.create',
    targetType: 'outcome',
    targetId: randomUUID(),
    payload: {},
    feedback: 'accepted',
    feedbackAt,
    createdAt: new Date(+now - 30 * 86_400_000),
  });
  const consumedJobId = randomUUID();
  await getDb().execute(sql`
    INSERT INTO agent_memory_feedback (user_id, action_id, version, feedback_at, job_id, processed_at)
    SELECT ${consumed.id}, ${consumedActionId},
      md5(feedback || ':' || coalesce(feedback_payload::text, 'null') || ':' || feedback_at::text),
      feedback_at, ${consumedJobId}, ${now}
    FROM agent_actions WHERE id = ${consumedActionId}
  `);

  await runAgentScheduler(now);

  const jobsOf = async (userId: string, jobType: string) =>
    getDb().select().from(agentJobs).where(and(eq(agentJobs.userId, userId), eq(agentJobs.jobType, jobType)));

  expect(await jobsOf(active.id, 'index.sync')).toHaveLength(1);
  expect(await jobsOf(active.id, 'notify.scan')).toHaveLength(1);
  expect(await jobsOf(active.id, 'reflect.daily')).toHaveLength(1);

  const feedbackJobs = await jobsOf(feedback.id, 'memory.distill');
  expect(feedbackJobs.some((job) => job.payload.mode === 'incremental')).toBe(true);

  const [editState] = await getDb()
    .select()
    .from(agentScheduling)
    .where(and(eq(agentScheduling.userId, editor.id), eq(agentScheduling.capability, 'memory.distill')));
  expect(editState?.urgent).toBe(true);
  expect(await jobsOf(editor.id, 'memory.distill')).toHaveLength(1);

  expect(await jobsOf(idle.id, 'index.sync')).toEqual([]);
  expect(await jobsOf(idle.id, 'memory.distill')).toEqual([]);

  const maintJobs = await jobsOf(maint.id, 'memory.distill');
  expect(maintJobs.some((job) => job.payload.mode === 'maintenance')).toBe(true);

  expect(await jobsOf(consumed.id, 'memory.distill')).toEqual([]);
});

it('manual routes bypass cooldown and only use the authenticated user', async () => {
  const user = await registerUser(app);
  await getDb().transaction(async tx => {
    await markAgentSchedule(tx, user.id, 'outcome.cluster', { now });
    await finishAgentSchedule(tx, user.id, 'outcome.cluster', 1, new Date());
  });
  const res = await injectJson(app, { method: 'POST', url: '/api/v1/agent/cluster', token: user.token, payload: { userId: randomUUID() } });
  expect(res.statusCode).toBe(202);
  const [job] = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, user.id));
  expect(job?.payload).toMatchObject({ manual: true, trigger: 'manual' });
});
