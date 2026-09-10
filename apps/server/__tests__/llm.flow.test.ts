import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { setPiResolveOverride } from '../src/llm/pi.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { inboxId, registerUser } from './helpers/session.js';

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

/** Route every resolution to a scriptable faux provider. */
function installFaux(texts: string[]) {
  const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1' }] });
  faux.setResponses(texts.map((t) => fauxAssistantMessage(t)));
  setPiResolveOverride((stored, route, apiKey) => {
    const models = createModels();
    models.setProvider(faux.provider);
    const model = models.getModel('faux', route.model);
    if (!model) return null;
    return { models, model, apiKey, route, stored };
  });
  return faux;
}

async function addFauxProvider(token: string): Promise<string> {
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/llm/providers',
    token,
    payload: {
      providerId: 'custom',
      label: '测试网关',
      baseUrl: 'http://faux.test/v1',
      apiKey: 'sk-secret-do-not-leak',
      models: ['faux-1'],
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json().providers[0].id as string;
}

describe('llm providers + routing', () => {
  it('stores providers without leaking keys; routing validates targets', async () => {
    const alice = await registerUser(app);
    const providerId = await addFauxProvider(alice.token);

    const me = await injectJson(app, { method: 'GET', url: '/api/v1/auth/me', token: alice.token });
    expect(me.json().llm.providers).toEqual([
      {
        id: providerId,
        providerId: 'custom',
        label: '测试网关',
        baseUrl: 'http://faux.test/v1',
        models: ['faux-1'],
        apiKeySet: true,
      },
    ]);
    expect(JSON.stringify(me.json())).not.toContain('sk-secret-do-not-leak');

    const badRoute = await injectJson(app, {
      method: 'PUT',
      url: '/api/v1/llm/routing',
      token: alice.token,
      payload: { routing: { default: { providerId, model: 'not-enabled' } } },
    });
    expect(badRoute.statusCode).toBe(400);

    const okRoute = await injectJson(app, {
      method: 'PUT',
      url: '/api/v1/llm/routing',
      token: alice.token,
      payload: {
        routing: {
          default: { providerId, model: 'faux-1' },
          'agent.headline': { providerId, model: 'faux-1', parameters: { temperature: 0.3 } },
        },
      },
    });
    expect(okRoute.statusCode).toBe(200);
    expect(okRoute.json().routing['agent.headline'].parameters).toEqual({ temperature: 0.3 });

    const removed = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/llm/providers/${providerId}`,
      token: alice.token,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().providers).toEqual([]);
    expect(removed.json().routing).toEqual({});
  });

  it('rejects unknown builtin provider and invalid custom baseUrl', async () => {
    const alice = await registerUser(app);
    const unknown = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/llm/providers',
      token: alice.token,
      payload: { providerId: 'nope', label: 'x', apiKey: 'sk-1', models: ['m'] },
    });
    expect(unknown.statusCode).toBe(400);
    const badUrl = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/llm/providers',
      token: alice.token,
      payload: {
        providerId: 'custom',
        label: 'x',
        baseUrl: 'not-a-url',
        apiKey: 'sk-1',
        models: ['m'],
      },
    });
    expect(badUrl.statusCode).toBe(400);
  });

  it('catalog lists builtin providers with models', async () => {
    const alice = await registerUser(app);
    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/llm/catalog',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().providers.map((p: { id: string }) => p.id);
    expect(ids).toContain('openai');
    expect(ids).toContain('deepseek');
    expect(ids).toContain('zhipu');
    const openai = res.json().providers.find((p: { id: string }) => p.id === 'openai');
    expect(openai.models.length).toBeGreaterThan(0);
  });

  it.each(['zhipu', 'openai'])('saves manually entered models for %s', async (providerId) => {
    const alice = await registerUser(app);
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/llm/providers',
      token: alice.token,
      payload: { providerId, label: providerId, apiKey: 'test-key', models: ['future-model'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().providers[0]).toMatchObject({ providerId, models: ['future-model'] });
  });

  it('persists independent model parameters and allows clearing them', async () => {
    const alice = await registerUser(app);
    const modelParameters = {
      'glm-5.3-flash': { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
      'glm-4.7': { thinking: { type: 'disabled' }, temperature: 0.5 },
    };
    const added = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/llm/providers',
      token: alice.token,
      payload: {
        providerId: 'zhipu',
        label: '智谱',
        apiKey: 'test-key',
        models: ['glm-5.3-flash', 'glm-4.7'],
        modelParameters,
      },
    });
    expect(added.statusCode).toBe(200);
    const id = added.json().providers[0].id as string;
    const me = await injectJson(app, { method: 'GET', url: '/api/v1/auth/me', token: alice.token });
    expect(me.json().llm.providers[0].modelParameters).toEqual(modelParameters);
    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/llm/providers/${id}`,
      token: alice.token,
      payload: { modelParameters: { ...modelParameters, 'glm-5.3-flash': {} } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().providers[0].modelParameters).toEqual({
      ...modelParameters,
      'glm-5.3-flash': {},
    });
    const invalid = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/llm/providers/${id}`,
      token: alice.token,
      payload: { modelParameters: { 'glm-4.7': { api_key: 'cannot-override' } } },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('test endpoint pings the provider via faux', async () => {
    const alice = await registerUser(app);
    const providerId = await addFauxProvider(alice.token);
    installFaux(['pong']);
    const ok = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/llm/providers/${providerId}/test`,
      token: alice.token,
      payload: { providerId, model: 'faux-1' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    const usage = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/usage',
      token: alice.token,
    });
    expect(usage.json()).toMatchObject({ modelRequests: 1, failedRequests: 0, legacyRuns: 0 });
    const executions = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/executions',
      token: alice.token,
    });
    expect(executions.statusCode).toBe(200);
    expect(executions.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: 'llm.test', status: 'succeeded' }),
      ]),
    );
  });
});

describe('create from text', () => {
  it('creates a task from natural language when a model is routed', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const providerId = await addFauxProvider(alice.token);
    await injectJson(app, {
      method: 'PUT',
      url: '/api/v1/llm/routing',
      token: alice.token,
      payload: { routing: { default: { providerId, model: 'faux-1' } } },
    });
    installFaux([
      JSON.stringify({
        title: '和设计组开会',
        notes: '讨论 Q3',
        priority: 1,
        dueDate: '2026-09-09',
        dueTime: '15:00',
        isAllDay: false,
        reminder: '15',
        recurrenceKind: null,
        listName: null,
        tagNames: [],
      }),
    ]);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks/from-text',
      token: alice.token,
      payload: {
        text: '明天下午3点和设计组开会讨论Q3',
        listId: inbox,
        smartListId: 'smart:today',
        timezone: 'Asia/Shanghai',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().title).toBe('和设计组开会');
    expect(created.json().notes).toBe('讨论 Q3');
    expect(created.json().priority).toBe(1);
    expect(created.json().isAllDay).toBe(false);
    expect(created.json().reminderMode).toBe('offset');
    expect(created.json().reminderOffsetMinutes).toBe(15);
    expect(created.json().dueAt).toBeTruthy();
    const usage = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/usage',
      token: alice.token,
    });
    expect(usage.json().totalRuns).toBe(1);
    expect(usage.json().items[0].capability).toBe('parse');
    expect(usage.json().totalPromptTokens).toBeGreaterThan(0);
    expect(usage.json().totalCompletionTokens).toBeGreaterThan(0);
  });

  it.each([true, false])(
    'retries malformed model output at most three times (success=%s)',
    async (success) => {
      const alice = await registerUser(app);
      const providerId = await addFauxProvider(alice.token);
      await injectJson(app, {
        method: 'PUT',
        url: '/api/v1/llm/routing',
        token: alice.token,
        payload: { routing: { default: { providerId, model: 'faux-1' } } },
      });
      installFaux([
        'bad json',
        'bad json',
        'bad json',
        success ? '{"title":"买牛奶"}' : 'bad json',
      ]);
      const response = await injectJson(app, {
        method: 'POST',
        url: '/api/v1/tasks/from-text',
        token: alice.token,
        payload: { text: '买牛奶' },
      });
      expect(response.statusCode).toBe(success ? 201 : 502);
      const usage = await injectJson(app, {
        method: 'GET',
        url: '/api/v1/agent/usage',
        token: alice.token,
      });
      expect(usage.json().totalRuns).toBe(4);
      const inbox = await inboxId(app, alice.token);
      const tasks = await injectJson(app, {
        method: 'GET',
        url: '/api/v1/tasks?listId=' + inbox,
        token: alice.token,
      });
      expect(tasks.json().items).toHaveLength(success ? 1 : 0);
    },
    15000,
  );

  it.each(['error', 'aborted', 'length'] as const)(
    'recovers from model %s responses',
    async (stopReason) => {
      const alice = await registerUser(app);
      const providerId = await addFauxProvider(alice.token);
      await injectJson(app, {
        method: 'PUT',
        url: '/api/v1/llm/routing',
        token: alice.token,
        payload: { routing: { default: { providerId, model: 'faux-1' } } },
      });
      const faux = installFaux([]);
      faux.setResponses([
        fauxAssistantMessage('incomplete', { stopReason }),
        fauxAssistantMessage('{"title":"买牛奶"}'),
      ]);
      const response = await injectJson(app, {
        method: 'POST',
        url: '/api/v1/tasks/from-text',
        token: alice.token,
        payload: { text: '买牛奶' },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().title).toBe('买牛奶');
      expect(faux.getPendingResponseCount()).toBe(0);
      const usage = await injectJson(app, {
        method: 'GET',
        url: '/api/v1/agent/usage',
        token: alice.token,
      });
      expect(usage.json()).toMatchObject({ modelRequests: 2, failedRequests: 1, legacyRuns: 0 });
      const executions = await injectJson(app, {
        method: 'GET',
        url: '/api/v1/agent/executions',
        token: alice.token,
      });
      expect(executions.statusCode).toBe(200);
      expect(executions.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            capability: 'task.parse',
            status: 'succeeded',
            targetId: response.json().id,
          }),
        ]),
      );
    },
  );

  it('falls back to a title-only task when no model is routed', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks/from-text',
      token: alice.token,
      payload: {
        text: '买牛奶',
        listId: inbox,
        smartListId: 'smart:today',
        timezone: 'Asia/Shanghai',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().title).toBe('买牛奶');
    expect(created.json().isAllDay).toBe(true);
    expect(created.json().dueAt).toBeTruthy();
  });
});
