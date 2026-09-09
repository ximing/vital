import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoredLlmProvider, User } from '../../src/db/schema.js';
import { encryptSecret } from '../../src/llm/crypto.js';
import {
  completeText,
  resolveModelFor,
  setPiResolveOverride,
  testProviderModel,
} from '../../src/llm/pi.js';

let server: Server;
let requests: Record<string, unknown>[];
let reject = false;
const stored: StoredLlmProvider = {
  id: 'saved-provider',
  providerId: 'zhipu',
  label: '智谱',
  apiKeyEnc: encryptSecret('test-key'),
  models: ['glm-5.3-flash'],
};
const user = {
  llmProviders: [stored],
  llmRouting: { default: { providerId: stored.id, model: stored.models[0] } },
} as unknown as User;

beforeEach(async () => {
  requests = [];
  reject = false;
  stored.modelParameters = {};
  user.llmRouting.default = { providerId: stored.id, model: 'glm-5.3-flash' };
  server = createServer((req, res) => {
    void (async () => {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      const payload = JSON.parse(body) as Record<string, unknown>;
      requests.push(payload);
      if (reject || (payload.thinking as { type?: string } | undefined)?.type !== 'enabled') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Thinking must be enabled' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        'data: ' +
          JSON.stringify({
            id: 'test',
            choices: [{ index: 0, delta: { content: '{"title":"测试"}' }, finish_reason: 'stop' }],
          }) +
          '\n\ndata: [DONE]\n\n',
      );
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const resolved = resolveModelFor(user, 'task.parse');
  if (!resolved) throw new Error('No model');
  setPiResolveOverride((_stored, route) => ({
    ...resolved,
    route,
    model: { ...resolved.model, baseUrl: `http://127.0.0.1:${address.port}/v1` },
  }));
});

afterEach(async () => {
  setPiResolveOverride(null);
  await new Promise<void>((resolve, rejectClose) =>
    server.close((err) => {
      if (err) rejectClose(err);
      else resolve();
    }),
  );
});

describe('always-thinking models', () => {
  it('enables supported reasoning for task completion', async () => {
    const result = await completeText(user, 'task.parse', {
      messages: [{ role: 'user', content: '测试' }],
      json: true,
    });
    expect(result?.text).toBe('{"title":"测试"}');
    expect(requests[0]).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
    });
  });
  it('enables supported reasoning for connection tests', async () => {
    await expect(testProviderModel(stored, 'glm-5.3-flash')).resolves.toEqual({ ok: true });
    expect(requests[0]).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low' });
  });
  it('uses saved per-model parameters for tasks and connection tests', async () => {
    stored.modelParameters = {
      'glm-5.3-flash': {
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        temperature: 0.4,
        max_tokens: 8192,
        top_p: 0.8,
      },
    };
    await completeText(user, 'task.parse', { messages: [{ role: 'user', content: '测试' }] });
    await testProviderModel(stored, 'glm-5.3-flash');
    for (const request of requests)
      expect(request).toMatchObject({
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        temperature: 0.4,
        max_tokens: 8192,
        top_p: 0.8,
      });
  });
  it('lets capability parameters override model defaults', async () => {
    stored.modelParameters = { 'glm-5.3-flash': { reasoning_effort: 'high', temperature: 0.4 } };
    user.llmRouting['task.parse'] = {
      providerId: stored.id,
      model: 'glm-5.3-flash',
      parameters: { reasoning_effort: 'low' },
    };
    await completeText(user, 'task.parse', { messages: [{ role: 'user', content: '测试' }] });
    expect(requests[0]).toMatchObject({ reasoning_effort: 'low', temperature: 0.4 });
    delete user.llmRouting['task.parse'];
  });
  it('does not report success when the provider returns an error', async () => {
    reject = true;
    await expect(testProviderModel(stored, 'glm-5.3-flash')).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
    });
  });
});
