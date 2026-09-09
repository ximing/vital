import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { User } from '../../src/db/schema.js';
import { completeChat, testLlmConnection } from '../../src/llm/client.js';
import { encryptSecret } from '../../src/llm/crypto.js';

function configuredUser(overrides: Partial<User>): User {
  return {
    id: 'test-user',
    email: 'test@example.com',
    passwordHash: '',
    displayName: 'Test',
    avatarAttachmentId: null,
    timezone: 'UTC',
    locale: 'zh-CN',
    themePreference: 'system',
    weekStartsOn: 1,
    convertArchiveOnComplete: false,
    notifyTaskRemind: true,
    notifyTaskDue: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    allDayNotifyTime: '09:00',
    onboarding: {},
    llmApiBase: null,
    llmApiKey: encryptSecret('test-key'),
    llmModel: 'glm-5.3-flash',
    llmParameters: {},
    passwordChangedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => {
    if (server)
      server.close(() => {
        resolve();
      });
    else resolve();
  });
});

async function endpoint(reply: (body: Record<string, unknown>) => unknown): Promise<string> {
  const localServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply(JSON.parse(raw) as Record<string, unknown>)));
    });
  });
  server = localServer;
  await new Promise<void>((resolve) => {
    localServer.listen(0, '127.0.0.1', resolve);
  });
  const address = localServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  return `http://127.0.0.1:${address.port}/v1`;
}

describe('OpenAI-compatible transport', () => {
  it('allows a reasoning model to finish the connection probe', async () => {
    const apiBase = await endpoint((body) =>
      Number(body.max_tokens) < 305
        ? {
            choices: [
              { finish_reason: 'length', message: { content: '', reasoning_content: 'Thinking' } },
            ],
          }
        : { choices: [{ finish_reason: 'stop', message: { content: 'pong' } }] },
    );
    const user = configuredUser({
      llmApiBase: apiBase,
      llmApiKey: encryptSecret('test-key'),
      llmModel: 'glm-5.3-flash',
      llmParameters: {},
    });
    await expect(testLlmConnection(user)).resolves.toEqual({ ok: true });
  });

  it('forwards provider parameters and preserves task JSON output', async () => {
    let received: Record<string, unknown> | undefined;
    const apiBase = await endpoint((body) => {
      received = body;
      return { choices: [{ finish_reason: 'stop', message: { content: '{"title":"买牛奶"}' } }] };
    });
    await completeChat({
      apiBase,
      apiKey: 'test-key',
      model: 'deepseek-model',
      messages: [{ role: 'user', content: '买牛奶' }],
      json: true,
      parameters: {
        thinking: { type: 'enabled' },
        reasoning_effort: 'low',
        temperature: 0.6,
        max_tokens: 4096,
        custom_option: { enabled: true },
      },
    });
    expect(received).toMatchObject({
      model: 'deepseek-model',
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
      temperature: 0.6,
      max_tokens: 4096,
      custom_option: { enabled: true },
      response_format: { type: 'json_object' },
    });
  });

  it('uses saved parameters in connection tests, including the token budget', async () => {
    let received: Record<string, unknown> | undefined;
    const apiBase = await endpoint((body) => {
      received = body;
      return { choices: [{ finish_reason: 'stop', message: { content: 'pong' } }] };
    });
    await testLlmConnection(
      configuredUser({
        llmApiBase: apiBase,
        llmApiKey: encryptSecret('test-key'),
        llmModel: 'glm',
        llmParameters: { thinking: { type: 'enabled' }, reasoning_effort: 'low', max_tokens: 4096 },
      }),
    );
    expect(received).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
      max_tokens: 4096,
    });
  });

  it('reports token exhaustion separately from connectivity failures', async () => {
    const apiBase = await endpoint(() => ({
      choices: [
        { finish_reason: 'length', message: { content: '', reasoning_content: 'Thinking' } },
      ],
    }));
    await expect(
      completeChat({ apiBase, apiKey: 'test-key', model: 'glm', messages: [] }),
    ).rejects.toMatchObject({ code: 'LLM_OUTPUT_TRUNCATED' });
  });

  it('still rejects empty successful responses', async () => {
    const apiBase = await endpoint(() => ({
      choices: [{ finish_reason: 'stop', message: { content: '' } }],
    }));
    await expect(
      completeChat({ apiBase, apiKey: 'test-key', model: 'glm', messages: [] }),
    ).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });

  it('uses max_completion_tokens without adding a conflicting max_tokens', async () => {
    let received: Record<string, unknown> | undefined;
    const apiBase = await endpoint((body) => {
      received = body;
      return { choices: [{ finish_reason: 'stop', message: { content: 'pong' } }] };
    });
    await testLlmConnection(
      configuredUser({ llmApiBase: apiBase, llmParameters: { max_completion_tokens: 4096 } }),
    );
    expect(received?.max_completion_tokens).toBe(4096);
    expect(received).not.toHaveProperty('max_tokens');
    expect(received).not.toHaveProperty('temperature');
    expect(received).not.toHaveProperty('thinking');
  });
});
