/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { extractNotes } from '@vital/dto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueReportGenerate, processDueAgentJobs } from '../../src/agent/jobs.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, agentJobs, agentUsage, reports } from '../../src/db/schema.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { inboxId, registerUser } from '../helpers/session.js';

let app: FastifyInstance;

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

async function setupFauxUser(name: string): Promise<{ id: string; token: string }> {
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

async function currentDaily(token: string): Promise<{ id: string; revision: number; bodyMd: string }> {
  const res = await injectJson(app, {
    method: 'GET',
    url: '/api/v1/reports/current?type=daily',
    token,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string; revision: number; bodyMd: string };
}

describe('POST /api/v1/reports/:id/generate', () => {
  it('rejects weekly reports and foreign ids', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const weekly = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=weekly',
      token: alice.token,
    });
    expect(weekly.statusCode).toBe(200);
    const weeklyId = weekly.json().id as string;

    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/reports/${weeklyId}/generate`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(400);

    const daily = await currentDaily(alice.token);
    const foreign = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/reports/${daily.id}/generate`,
      token: bob.token,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('queues a report.generate job; a retrigger stays a single job', async () => {
    const alice = await registerUser(app, 'alice');
    const daily = await currentDaily(alice.token);

    const first = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/reports/${daily.id}/generate`,
      token: alice.token,
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ status: 'queued', jobId: expect.any(String) });

    const again = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/reports/${daily.id}/generate`,
      token: alice.token,
    });
    expect(again.statusCode).toBe(202);

    const jobs = await getDb()
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.dedupKey, `report.generate:${daily.id}`));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.jobType).toBe('report.generate');
    expect(jobs[0]!.payload).toMatchObject({ reportId: daily.id, manual: true });
  });
});

describe('report.generate processor', () => {
  it('writes notes from the day facts and records an accepted action', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('submit_report', { notes: '完成了纪要，评审还差一页。' })),
    ]);

    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '写纪要', listId: inbox },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as string;
    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/complete`,
      token: alice.token,
    });
    expect(done.statusCode).toBe(200);

    const daily = await currentDaily(alice.token);
    await enqueueReportGenerate(getDb(), alice.id, daily.id, new Date());
    const n = await processDueAgentJobs(new Date());
    expect(n).toBe(1);
    expect(faux.state.callCount).toBe(1);

    const [row] = await getDb().select().from(reports).where(eq(reports.id, daily.id));
    expect(extractNotes(row!.bodyMd, 'daily')).toBe('完成了纪要，评审还差一页。');
    expect(row!.revision).toBe(daily.revision + 1);

    const actions = await getDb()
      .select()
      .from(agentActions)
      .where(and(eq(agentActions.targetId, daily.id), eq(agentActions.actionType, 'report.generate')));
    expect(actions).toHaveLength(1);
    expect(actions[0]!.targetType).toBe('report');
    expect(actions[0]!.feedback).toBe('accepted');
    expect(actions[0]!.payload['notes']).toBe('完成了纪要，评审还差一页。');

    const usage = await getDb().select().from(agentUsage).where(eq(agentUsage.userId, alice.id));
    expect(usage).toHaveLength(1);
    expect(usage[0]!.capability).toBe('report');
  });

  it('overwrites existing notes when the user asked to generate', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('submit_report', { notes: '整理后的当日记录。' })),
    ]);
    const daily = await currentDaily(alice.token);
    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/reports/${daily.id}`,
      token: alice.token,
      payload: { revision: daily.revision, bodyMd: `${daily.bodyMd}\n手写一句。\n` },
    });
    expect(patched.statusCode).toBe(200);

    await enqueueReportGenerate(getDb(), alice.id, daily.id, new Date());
    await processDueAgentJobs(new Date());
    expect(faux.state.callCount).toBe(1);
    const [row] = await getDb().select().from(reports).where(eq(reports.id, daily.id));
    expect(extractNotes(row!.bodyMd, 'daily')).toBe('整理后的当日记录。');
  });

  it('degrades cleanly when no LLM is routed', async () => {
    const alice = await registerUser(app, 'alice');
    const daily = await currentDaily(alice.token);
    await enqueueReportGenerate(getDb(), alice.id, daily.id, new Date());
    await processDueAgentJobs(new Date());
    const jobs = await getDb()
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.dedupKey, `report.generate:${daily.id}`));
    expect(jobs[0]!.status).toBe('done');
    expect(jobs[0]!.lastError).toBe('skipped:no-llm');
    const [row] = await getDb().select().from(reports).where(eq(reports.id, daily.id));
    expect(extractNotes(row!.bodyMd, 'daily')).toBe('');
  });
});

describe('report.generate action listing', () => {
  it('resolves the report title as the target name', async () => {
    const alice = await registerUser(app, 'alice');
    const daily = await currentDaily(alice.token);
    await getDb().insert(agentActions).values({
      id: randomUUID(),
      userId: alice.id,
      actionType: 'report.generate',
      targetType: 'report',
      targetId: daily.id,
      payload: { notes: '今天把纪要写完了。' },
      feedback: 'accepted',
    });
    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/agent/actions?targetType=report&targetId=${daily.id}`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({
        actionType: 'report.generate',
        targetType: 'report',
        targetName: expect.stringContaining('日报'),
        payloadSummary: '今天把纪要写完了。',
        feedback: 'accepted',
      }),
    ]);
  });
});
