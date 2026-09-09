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
import { enqueueOutcomeRefresh, processDueAgentJobs } from '../../src/agent/jobs.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, agentJobs, agentMemory, agentUsage, outcomes } from '../../src/db/schema.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import { refreshOutcomeRuleFields } from '../../src/outcomes/outcomes.service.js';
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

/** Route every resolution to a scriptable faux provider (mirror of llm.flow.test.ts). */
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

async function createOutcome(token: string, name = '上线 Q3'): Promise<string> {
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/outcomes',
    token,
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

async function createTask(token: string, outcomeId: string, title: string): Promise<string> {
  const inbox = await inboxId(app, token);
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/tasks',
    token,
    payload: { title, listId: inbox, outcomeId },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function outcomeRow(outcomeId: string) {
  const [row] = await getDb().select().from(outcomes).where(eq(outcomes.id, outcomeId));
  return row!;
}

describe('agent harness: outcome.refresh', () => {
  it('materializes headline/suggestion, writes the action ledger and usage, one round (critic off)', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_headline', { headline: '在推进 Q3 上线', suggestion: '先完成设计稿' }),
      ),
    ]);
    const outcomeId = await createOutcome(alice.token);
    await createTask(alice.token, outcomeId, '写设计稿');

    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });
    const n = await processDueAgentJobs(new Date());
    expect(n).toBe(1);
    // Critic is disabled by default → exactly one LLM round.
    expect(faux.state.callCount).toBe(1);

    const outcome = await outcomeRow(outcomeId);
    expect(outcome.agentHeadline).toBe('在推进 Q3 上线');
    expect(outcome.agentSuggestion).toBe('先完成设计稿');
    expect(outcome.agentState).toBe('idle');
    expect(outcome.agentUpdatedAt).not.toBeNull();

    const actions = await getDb()
      .select()
      .from(agentActions)
      .where(and(eq(agentActions.userId, alice.id), eq(agentActions.targetId, outcomeId)));
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.actionType).sort()).toEqual([
      'outcome.headline',
      'outcome.suggestion',
    ]);
    expect(actions.every((a) => a.feedback === 'pending' && a.jobId !== null)).toBe(true);

    const usage = await getDb().select().from(agentUsage).where(eq(agentUsage.userId, alice.id));
    expect(usage).toHaveLength(1);
    expect(usage[0]!.capability).toBe('headline');
    expect(usage[0]!.model).toBe('faux-1');
    expect(usage[0]!.promptTokens).toBeGreaterThan(0);

    const jobRows = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    const refreshJob = jobRows.find((j) => j.jobType === 'outcome.refresh')!;
    expect(refreshJob.status).toBe('done');
    expect(refreshJob.lastError).toBeNull();
  });

  it('without LLM credentials the job is skipped and rule-layer content is preserved', async () => {
    const alice = await registerUser(app);
    const outcomeId = await createOutcome(alice.token);
    await createTask(alice.token, outcomeId, '写设计稿');
    await refreshOutcomeRuleFields(alice.id, outcomeId);
    const before = await outcomeRow(outcomeId);
    expect(before.ruleNextStep).toBe('写设计稿');

    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });
    await processDueAgentJobs(new Date());

    const after = await outcomeRow(outcomeId);
    expect(after.agentHeadline).toBeNull();
    expect(after.agentState).toBe('idle');
    expect(after.ruleNextStep).toBe('写设计稿');

    const jobRows = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    const refreshJob = jobRows.find((j) => j.jobType === 'outcome.refresh')!;
    expect(refreshJob.status).toBe('done');
    expect(refreshJob.lastError).toBe('skipped:no-llm');
  });

  it('a provider error backs the job off; the retry materializes', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([
      fauxAssistantMessage('boom', { stopReason: 'error', errorMessage: 'provider 5xx' }),
    ]);
    const outcomeId = await createOutcome(alice.token);
    await createTask(alice.token, outcomeId, '写设计稿');

    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });
    const t0 = new Date();
    await processDueAgentJobs(t0);

    let jobRows = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    let refreshJob = jobRows.find((j) => j.jobType === 'outcome.refresh')!;
    expect(refreshJob.status).toBe('pending');
    expect(refreshJob.attemptCount).toBe(1);
    expect(refreshJob.lastError).toContain('provider 5xx');
    expect(refreshJob.nextAttemptAt!.getTime()).toBe(t0.getTime() + 30_000);

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_headline', { headline: '恢复了', suggestion: '' }),
      ),
    ]);
    await processDueAgentJobs(new Date(t0.getTime() + 31_000));

    jobRows = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    refreshJob = jobRows.find((j) => j.jobType === 'outcome.refresh')!;
    expect(refreshJob.status).toBe('done');
    const outcome = await outcomeRow(outcomeId);
    expect(outcome.agentHeadline).toBe('恢复了');
    expect(outcome.agentSuggestion).toBeNull();
  });

  it('POST /outcomes/:id/refresh returns 202 and marks the thread pending', async () => {
    const alice = await registerUser(app);
    const outcomeId = await createOutcome(alice.token);
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/refresh`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(202);
    const outcome = await outcomeRow(outcomeId);
    expect(outcome.agentState).toBe('pending');
    const jobRows = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    expect(jobRows.some((j) => j.jobType === 'outcome.refresh')).toBe(true);

    const other = await registerUser(app, 'bob');
    const forbidden = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/refresh`,
      token: other.token,
    });
    expect(forbidden.statusCode).toBe(404);
  });

  it('feedback edited applies the edited headline in the same transaction; second feedback 409', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_headline', { headline: '原始状态', suggestion: '建议' }),
      ),
    ]);
    const outcomeId = await createOutcome(alice.token);
    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });
    await processDueAgentJobs(new Date());

    const [headlineAction] = await getDb()
      .select()
      .from(agentActions)
      .where(and(eq(agentActions.userId, alice.id), eq(agentActions.actionType, 'outcome.headline')));
    const edited = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${headlineAction!.id}/feedback`,
      token: alice.token,
      payload: { feedback: 'edited', editedPayload: { headline: '用户改后的状态' } },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().feedback).toBe('edited');
    expect((await outcomeRow(outcomeId)).agentHeadline).toBe('用户改后的状态');

    const again = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${headlineAction!.id}/feedback`,
      token: alice.token,
      payload: { feedback: 'accepted' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('injects distilled memory into the prompt as labelled data', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    await getDb().insert(agentMemory).values({
      id: randomUUID(),
      userId: alice.id,
      kind: 'preference',
      content: '用户偏好：headline 不要出现「冲刺」',
    });

    let seenContext: Context | null = null;
    faux.setResponses([
      (context) => {
        seenContext = context;
        return fauxAssistantMessage(
          fauxToolCall('submit_headline', { headline: '稳步推进', suggestion: '' }),
        );
      },
    ]);
    const outcomeId = await createOutcome(alice.token);
    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });
    await processDueAgentJobs(new Date());

    expect(seenContext).not.toBeNull();
    const ctx = seenContext as unknown as Context;
    const userText = ctx.messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
    expect(ctx.systemPrompt).toContain('<data>');
    expect(userText).toContain('从用户纠偏中学到的偏好');
    expect(userText).toContain('用户偏好：headline 不要出现「冲刺」');
  });
});
