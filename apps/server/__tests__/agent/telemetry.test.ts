import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { getUserEntity } from '../../src/auth/auth.service.js';
import { getDb } from '../../src/db/index.js';
import { agentExecutions, agentJobs, agentModelBudgets, agentUsage } from '../../src/db/schema.js';
import { enqueueOutcomeRefresh, processDueAgentJobs } from '../../src/agent/jobs.js';
import { config } from '../../src/config.js';
import { completeText, setPiResolveOverride } from '../../src/llm/pi.js';
import { runProposalPass } from '../../src/agent/harness.js';
import { submitHeadlineTool } from '../../src/agent/tools.js';
import { dailyUsage } from '../../src/agent/usage.service.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

let app: FastifyInstance;
beforeAll(async () => { app = await buildFastify(); });
beforeEach(resetDb);
afterEach(() => {
  setPiResolveOverride(null);
});
afterAll(async () => { await app.close(); });

async function configuredUser(name = 'alice') {
  const account = await registerUser(app, name);
  const added = await injectJson(app, {
    method: 'POST', url: '/api/v1/llm/providers', token: account.token,
    payload: { providerId: 'custom', label: '测试', baseUrl: 'http://faux.test/v1', apiKey: 'sk-private',
      models: ['faux-1'] },
  });
  const providerId = added.json().providers[0].id as string;
  await injectJson(app, {
    method: 'PUT', url: '/api/v1/llm/routing', token: account.token,
    payload: { routing: { default: { providerId, model: 'faux-1' } } },
  });
  return { ...account, user: await getUserEntity(account.id) };
}

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

describe('automatic model and execution telemetry', () => {
  it('defers an exhausted background budget durably without calling a model, and lets an explicit manual request proceed', async () => {
    const alice = await configuredUser();
    const faux = installFaux();
    faux.setResponses([fauxAssistantMessage(fauxToolCall('submit_headline', { headline: 'manual result', suggestion: '' }))]);
    const day = DateTime.now().setZone(alice.user.timezone).toISODate();
    if (!day) throw new Error('invalid day');
    await getDb().insert(agentModelBudgets).values({ userId: alice.id, day, requests: config.AGENT_DAILY_MODEL_CALL_LIMIT });
    const response = await injectJson(app, { method: 'POST', url: '/api/v1/outcomes', token: alice.token, payload: { name: 'budget test' } });
    const outcomeId = response.json().id as string;
    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });
    expect(await processDueAgentJobs()).toBe(1);
    expect(faux.state.callCount).toBe(0);
    const [deferred] = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    expect(deferred).toMatchObject({ status: 'pending', lastError: 'DAILY_MODEL_BUDGET', attemptCount: 0 });
    expect(deferred?.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
    const executions = await getDb().select().from(agentExecutions).where(eq(agentExecutions.userId, alice.id));
    expect(executions.every(e => e.status === 'skipped' && e.reason === 'DAILY_MODEL_BUDGET')).toBe(true);
    expect(await getDb().select().from(agentUsage)).toHaveLength(0);
    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0, manual: true });
    expect(await processDueAgentJobs()).toBe(1);
    expect(faux.state.callCount).toBe(1);
    expect((await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id)))[0]?.status).toBe('done');
  });
  it('persists running records before a request and finalizes with unknown usage after failure', async () => {
    const alice = await configuredUser();
    const faux = installFaux();
    let observedRunning = false;
    faux.setResponses([async () => {
      const calls = await getDb().select().from(agentUsage).where(eq(agentUsage.userId, alice.id));
      const executions = await getDb().select().from(agentExecutions).where(eq(agentExecutions.userId, alice.id));
      observedRunning = calls[0]?.status === 'running' && executions[0]?.status === 'running';
      const message = fauxAssistantMessage('private body', { stopReason: 'error', errorMessage: 'sk-private http://secret' });
      message.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
      return message;
    }]);
    await expect(completeText(alice.user, 'task.parse', { messages: [{ role: 'user', content: 'private prompt' }] }))
      .rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
    expect(observedRunning).toBe(true);
    const calls = await getDb().select().from(agentUsage).where(eq(agentUsage.userId, alice.id));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: 'failed', costMicros: null, reason: 'LLM_UNAVAILABLE' });
    expect(calls[0]?.promptTokens).toBeGreaterThan(0);
    expect(calls[0]?.completionTokens).toBeGreaterThan(0);
    expect(calls[0]?.durationMs).toBeGreaterThanOrEqual(0);
    const summary = await dailyUsage(alice.id, 30, 'UTC');
    expect(summary).toMatchObject({ modelRequests: 1, failedRequests: 1, unknownUsageRequests: 0, unknownCostRequests: 1, legacyRuns: 0 });
    const executions = await injectJson(app, { method: 'GET', url: '/api/v1/agent/executions', token: alice.token });
    expect(executions.json()[0]).toMatchObject({ status: 'failed', reason: 'LLM_UNAVAILABLE' });
    expect(JSON.stringify(executions.json())).not.toContain('sk-private');
    expect(JSON.stringify(calls)).not.toContain('private prompt');
  });

  it('counts each turn of an Agent loop once, including an invalid tool call', async () => {
    const alice = await configuredUser();
    const faux = installFaux();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('unknown_tool', {})),
      fauxAssistantMessage(fauxToolCall('submit_headline', { headline: '完成', suggestion: '' })),
    ]);
    const result = await runProposalPass({
      user: alice.user, capability: 'agent.headline',
      systemPrompt: 'submit headline', userPrompt: 'test', makeTool: submitHeadlineTool,
    });
    expect(result?.args).toMatchObject({ headline: '完成' });
    expect(faux.state.callCount).toBe(2);
    const calls = await getDb().select().from(agentUsage).where(eq(agentUsage.userId, alice.id));
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((call) => call.executionId)).size).toBe(1);
    expect(calls.every((call) => call.status === 'succeeded')).toBe(true);
    expect(await dailyUsage(alice.id, 30, 'UTC')).toMatchObject({ modelRequests: 2, legacyRuns: 0 });
  });

  it('retains usage when the Agent returns text without a proposal', async () => {
    const alice = await configuredUser();
    const faux = installFaux();
    faux.setResponses([fauxAssistantMessage('I did not use the tool')]);
    await expect(runProposalPass({
      user: alice.user, capability: 'agent.headline', systemPrompt: 'submit',
      userPrompt: 'test', makeTool: submitHeadlineTool,
    })).rejects.toThrow('did not submit');
    const calls = await getDb().select().from(agentUsage).where(eq(agentUsage.userId, alice.id));
    const executions = await getDb().select().from(agentExecutions).where(eq(agentExecutions.userId, alice.id));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.promptTokens).toBeGreaterThan(0);
    expect(executions[0]?.status).toBe('failed');
  });

  it('isolates concurrent callers and scopes execution history to its owner', async () => {
    const alice = await configuredUser('alice');
    const bob = await configuredUser('bob');
    const faux = installFaux();
    faux.setResponses([fauxAssistantMessage('A'), fauxAssistantMessage('B')]);
    await Promise.all([alice, bob].map(({ user }) =>
      completeText(user, 'task.parse', { messages: [{ role: 'user', content: 'test' }] })));
    for (const account of [alice, bob]) {
      const calls = await getDb().select().from(agentUsage).where(eq(agentUsage.userId, account.id));
      const response = await injectJson(app, { method: 'GET', url: '/api/v1/agent/executions', token: account.token });
      expect(response.json()).toHaveLength(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.executionId).toBe(response.json()[0].id);
    }
    expect((await injectJson(app, { method: 'GET', url: '/api/v1/agent/executions?days=0', token: alice.token })).statusCode).toBe(400);
  });

  it('records skipped execution without inventing a model call when no model is configured', async () => {
    const alice = await registerUser(app);
    expect(await completeText(await getUserEntity(alice.id), 'task.parse', { messages: [] })).toBeNull();
    const response = await injectJson(app, { method: 'GET', url: '/api/v1/agent/executions', token: alice.token });
    expect(response.json()[0]).toMatchObject({ status: 'skipped', reason: 'NO_MODEL' });
    expect(await dailyUsage(alice.id, 30, 'UTC')).toMatchObject({ modelRequests: 0, totalRuns: 0 });
  });

  it('keeps raw model transports and usage writes confined to the telemetry boundary', () => {
    const root = fileURLToPath(new URL('../../src', import.meta.url));
    const files: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) visit(join(dir, entry.name));
        else if (entry.name.endsWith('.ts')) files.push(join(dir, entry.name));
      }
    };
    visit(root);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (/\.(completeSimple|streamSimple)\(/.test(source)) expect(file).toBe(join(root, 'llm/model-transport.ts'));
      if (/\.insert\(agentUsage\)/.test(source)) expect(file).toBe(join(root, 'llm/telemetry.ts'));
    }
  });
});
