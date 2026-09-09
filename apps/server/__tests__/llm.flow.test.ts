import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { setLlmTransport } from '../src/llm/client.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { inboxId, registerUser } from './helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterEach(() => {
  setLlmTransport(null);
});

afterAll(async () => {
  await app.close();
});

describe('llm settings + create from text', () => {
  it('stores LLM settings without returning the key', async () => {
    const alice = await registerUser(app);
    const saved = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token: alice.token,
      payload: {
        llm: {
          apiBase: 'https://open.bigmodel.cn/api/paas/v4',
          apiKey: 'sk-secret-do-not-leak',
          model: 'glm-4-flash',
          parameters: { thinking: { type: 'enabled' }, reasoning_effort: 'low' },
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().llm).toEqual({
      apiBase: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
      apiKeySet: true,
      parameters: { thinking: { type: 'enabled' }, reasoning_effort: 'low' },
    });
    expect(JSON.stringify(saved.json())).not.toContain('sk-secret-do-not-leak');

    const me = await injectJson(app, { method: 'GET', url: '/api/v1/auth/me', token: alice.token });
    expect(me.json().llm.apiKeySet).toBe(true);
    expect(me.json().llm.parameters).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    });
    expect(JSON.stringify(me.json())).not.toContain('sk-secret-do-not-leak');
    const preserved = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token: alice.token,
      payload: { llm: { model: 'another-model' } },
    });
    expect(preserved.json().llm.parameters).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    });
    const cleared = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token: alice.token,
      payload: { llm: { parameters: null } },
    });
    expect(cleared.json().llm.parameters).toEqual({});
  });

  it('creates a task from natural language when the model is configured', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token: alice.token,
      payload: {
        llm: {
          apiBase: 'https://open.bigmodel.cn/api/paas/v4',
          apiKey: 'sk-test',
          model: 'glm-4-flash',
          parameters: { thinking: { type: 'disabled' }, temperature: 0.3 },
        },
      },
    });
    setLlmTransport({
      complete(input) {
        expect(input.parameters).toEqual({ thinking: { type: 'disabled' }, temperature: 0.3 });
        return Promise.resolve(
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
        );
      },
    });
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
  });

  it('falls back to a title-only task when LLM is not configured', async () => {
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

  it('test endpoint requires a configured model', async () => {
    const alice = await registerUser(app);
    const missing = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/llm/test',
      token: alice.token,
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('LLM_NOT_CONFIGURED');

    await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token: alice.token,
      payload: {
        llm: {
          apiBase: 'https://open.bigmodel.cn/api/paas/v4',
          apiKey: 'sk-test',
          model: 'glm-4-flash',
        },
      },
    });
    setLlmTransport({
      complete() {
        return Promise.resolve('pong');
      },
    });
    const ok = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/llm/test',
      token: alice.token,
      payload: {},
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
  });
});
