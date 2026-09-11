/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
} from '@earendil-works/pi-ai';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAgentScheduler } from '../../src/agent/scheduler.js';
import { buildDistillPrompt } from '../../src/agent/prompts.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import {
  agentEditEvents,
  agentEditFeedback,
  agentJobs,
  agentScheduling,
} from '../../src/db/schema.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';
import { enqueueAgentJob, processDueAgentJobs } from '../../src/agent/jobs.js';

let app: FastifyInstance;
const now = new Date('2026-09-10T08:00:00.000Z');

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterEach(() => {
  setPiResolveOverride(null);
});

afterAll(async () => {
  await app.close();
});

async function distillJobsOf(userId: string) {
  return getDb()
    .select()
    .from(agentJobs)
    .where(and(eq(agentJobs.userId, userId), eq(agentJobs.jobType, 'memory.distill')));
}

async function seedEditEvent(
  userId: string,
  fields: { field: string; before: unknown; after: unknown }[],
  // Old enough that the urgent distill deadline (event time + 5 min) is already due.
  createdAt = new Date(+now - 600_000),
): Promise<string> {
  const id = randomUUID();
  await getDb().insert(agentEditEvents).values({
    id,
    userId,
    entityType: 'task',
    entityId: randomUUID(),
    fields,
    createdAt,
  });
  return id;
}

describe('scheduler: edit events drive memory.distill', () => {
  it('marks memory.distill when unconsumed edit events exist', async () => {
    const user = await registerUser(app);
    await seedEditEvent(user.id, [{ field: 'title', before: '写季度总结', after: '写周报' }]);

    await runAgentScheduler(now);
    const jobs = await distillJobsOf(user.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toMatchObject({ mode: 'incremental' });

    // A user edit is a strong correction signal — the schedule is urgent.
    const [state] = await getDb()
      .select()
      .from(agentScheduling)
      .where(
        and(eq(agentScheduling.userId, user.id), eq(agentScheduling.capability, 'memory.distill')),
      );
    expect(state!.urgent).toBe(true);
    expect(state!.pendingCount).toBeGreaterThan(0);
  });

  it('does not re-mark once the events are consumed', async () => {
    const user = await registerUser(app);
    const eventId = await seedEditEvent(user.id, [
      { field: 'title', before: '写季度总结', after: '写周报' },
    ]);

    await runAgentScheduler(now);
    // Distill consumed the event.
    await getDb().insert(agentEditFeedback).values({
      userId: user.id,
      eventId,
      jobId: randomUUID(),
      processedAt: now,
    });

    await runAgentScheduler(new Date(+now + 120_000));
    expect(await distillJobsOf(user.id)).toHaveLength(1);
  });
});

describe('buildDistillPrompt edit facts', () => {
  it('renders user edits as correction signals', () => {
    const { system, user } = buildDistillPrompt({
      actions: [],
      existingMemory: [],
      edits: [
        {
          entityType: 'task',
          fields: [
            { field: 'title', before: '写季度总结', after: '写周报' },
            { field: 'dueAt', before: null, after: '2026-09-20T02:00:00.000Z' },
          ],
        },
        { entityType: 'outcome', fields: [{ field: 'name', before: '换工作', after: '换到 AI 公司' }] },
      ],
    });
    expect(user).toContain('[edit/task] 标题 "写季度总结" → "写周报"');
    expect(user).toContain('截止时间');
    expect(user).toContain('[edit/outcome] 名称 "换工作" → "换到 AI 公司"');
    // The prompt tells the model these direct edits are correction signals.
    expect(system).toContain('直接修改');
  });

  it('is unchanged when no edits are passed', () => {
    const base = { actions: [], existingMemory: [] };
    const plain = buildDistillPrompt(base);
    expect(buildDistillPrompt({ ...base, edits: [] })).toEqual(plain);
  });
});

describe('processMemoryDistill consumes edit events', () => {
  function installFaux() {
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1' }] });
    setPiResolveOverride((stored, route, apiKey) => {
      const models = createModels();
      models.setProvider(faux.provider);
      const model = models.getModel('faux', route.model);
      if (!model) return null;
      return { models, model, apiKey, route, stored };
    });
    return faux;
  }

  async function setupFauxUser(name: string) {
    const user = await registerUser(app, name);
    const added = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/llm/providers',
      token: user.token,
      payload: {
        providerId: 'custom',
        label: '测试网关',
        baseUrl: 'http://faux.test/v1',
        apiKey: 'sk-secret',
        models: ['faux-1'],
      },
    });
    expect(added.statusCode).toBe(200);
    const providerId = added.json().providers[0].id as string;
    const routed = await injectJson(app, {
      method: 'PUT',
      url: '/api/v1/llm/routing',
      token: user.token,
      payload: { routing: { default: { providerId, model: 'faux-1' } } },
    });
    expect(routed.statusCode).toBe(200);
    return user;
  }

  function contextText(ctx: Context): string {
    return ctx.messages
      .filter((m) => m.role === 'user')
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : m.content
              .map((part) =>
                typeof part === 'object' && 'text' in part ? part.text : JSON.stringify(part),
              )
              .join(''),
      )
      .join('\n');
  }

  async function runDistill(userId: string): Promise<void> {
    await enqueueAgentJob(getDb(), {
      userId,
      jobType: 'memory.distill',
      payload: { date: '2026-W37' },
      dedupKey: `memory.distill:${userId}:${randomUUID()}`,
      scheduledAt: new Date(Date.now() - 1_000),
    });
    const n = await processDueAgentJobs(new Date());
    expect(n).toBe(1);
    const [job] = await getDb()
      .select()
      .from(agentJobs)
      .where(and(eq(agentJobs.userId, userId), eq(agentJobs.jobType, 'memory.distill')));
    expect(job!.status).toBe('done');
    expect(job!.lastError).toBeNull();
  }

  it('feeds the edit fact into the prompt and marks it consumed', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    const eventId = await seedEditEvent(alice.id, [
      { field: 'title', before: '写季度总结', after: '写周报' },
    ]);

    let seen: Context | null = null;
    faux.setResponses([
      (context) => {
        seen = context;
        return fauxAssistantMessage(fauxToolCall('submit_memories', { keep: [], update: [], add: [], drop: [] }));
      },
    ]);
    await runDistill(alice.id);

    // The edit fact reached the model.
    expect(seen).not.toBeNull();
    const text = contextText(seen as unknown as Context);
    expect(text).toContain('[edit/task] 标题 "写季度总结" → "写周报"');

    // Consumption is recorded with the processing job.
    const consumed = await getDb()
      .select()
      .from(agentEditFeedback)
      .where(eq(agentEditFeedback.userId, alice.id));
    expect(consumed).toHaveLength(1);
    expect(consumed[0]!.eventId).toBe(eventId);
    const [job] = await distillJobsOf(alice.id);
    expect(consumed[0]!.jobId).toBe(job!.id);

    // A second run with nothing new skips without calling the model again.
    await runDistill(alice.id);
    expect(faux.state.callCount).toBe(1);
  });
});
