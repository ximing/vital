import type { FastifyInstance } from 'fastify';
import { beforeEach, afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildFastify } from '../src/app.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { registerUser } from './helpers/session.js';

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  request: vi.fn(),
}));

const { request } = await import('undici');
const requestMock = request as unknown as ReturnType<typeof vi.fn>;

function undiciReply(status: number, body: unknown): void {
  requestMock.mockResolvedValueOnce({
    statusCode: status,
    body: { text: () => Promise.resolve(JSON.stringify(body)) },
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  requestMock.mockReset();
});

afterAll(async () => {
  await app.close();
});

const KEY = 'iwt_' + 'A'.repeat(48);

async function saveConfig(token: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const res = await injectJson(app, {
    method: 'PUT',
    url: '/api/v1/integrations/inwit',
    token,
    payload: { baseUrl: 'http://127.0.0.1:3020', accessKey: KEY, ...overrides },
  });
  expect(res.statusCode).toBe(200);
}

describe('inwit config', () => {
  it('stores accessKey encrypted and never returns it', async () => {
    const alice = await registerUser(app);
    await saveConfig(alice.token, { defaultTopicId: null });

    const got = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/integrations/inwit',
      token: alice.token,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({
      baseUrl: 'http://127.0.0.1:3020',
      accessKeySet: true,
      defaultTopicId: null,
    });
    expect(JSON.stringify(got.json())).not.toContain(KEY);

    // Unconfigured user gets the default baseUrl with accessKeySet: false.
    const bob = await registerUser(app);
    const fresh = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/integrations/inwit',
      token: bob.token,
    });
    expect(fresh.json()).toEqual({
      baseUrl: 'https://inwit.aimo.plus',
      accessKeySet: false,
      defaultTopicId: null,
    });
  });

  it('test verifies the key against inwit and returns topics', async () => {
    const alice = await registerUser(app);
    await saveConfig(alice.token);
    undiciReply(200, { items: [{ id: 't1', title: '机器学习' }] });

    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/integrations/inwit/test',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, topics: [{ id: 't1', title: '机器学习' }] });
  });

  it('test maps 401 to INWIT_KEY_INVALID', async () => {
    const alice = await registerUser(app);
    await saveConfig(alice.token);
    undiciReply(401, { error: { code: 'INVALID_TOKEN' } });

    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/integrations/inwit/test',
      token: alice.token,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INWIT_KEY_INVALID');
  });
});

describe('inbox export to inwit', () => {
  async function createItem(token: string, body: Record<string, unknown>): Promise<string> {
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token,
      payload: { title: '一篇好文章', source: 'web', ...body },
    });
    expect([200, 201]).toContain(res.statusCode);
    return res.json().id as string;
  }

  it('sends html, stores the document id, and is idempotent', async () => {
    const alice = await registerUser(app);
    await saveConfig(alice.token, { defaultTopicId: null });
    const id = await createItem(alice.token, { extractedHtml: '<p>正文</p>' });

    undiciReply(201, { id: '0f9c2c1e-1111-4222-8333-444455556666' });
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${id}/export-inwit`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().inwitDocumentId).toBe('0f9c2c1e-1111-4222-8333-444455556666');
    expect(res.json().inbox.inwitExportedAt).not.toBeNull();

    const [url, opts] = requestMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe('http://127.0.0.1:3020/api/open/documents');
    const payload = JSON.parse(opts.body) as { title: string; html: string; sourceUrl?: string };
    expect(payload.title).toBe('一篇好文章');
    expect(payload.html).toContain('正文');
    expect(opts.headers.authorization).toBe(`Bearer ${KEY}`);

    // Second export is idempotent — no additional HTTP call.
    const again = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${id}/export-inwit`,
      token: alice.token,
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().inwitDocumentId).toBe('0f9c2c1e-1111-4222-8333-444455556666');
    expect(requestMock.mock.calls.length).toBe(1);
  });

  it('falls back to extractedText when no html', async () => {
    const alice = await registerUser(app);
    await saveConfig(alice.token);
    const id = await createItem(alice.token, { extractedText: '纯文本第一行' });

    undiciReply(201, { id: '0f9c2c1e-aaaa-4222-8333-444455556666' });
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${id}/export-inwit`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(201);
    const payload = JSON.parse((requestMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      html: string;
    };
    expect(payload.html).toContain('<p>纯文本第一行</p>');
  });

  it('maps 401 to INWIT_KEY_INVALID and empty body to INWIT_EMPTY_BODY', async () => {
    const alice = await registerUser(app);
    await saveConfig(alice.token);
    const bad = await createItem(alice.token, { extractedHtml: '<p>x</p>' });
    undiciReply(401, {});
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${bad}/export-inwit`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INWIT_KEY_INVALID');

    const empty = await createItem(alice.token, {});
    const res2 = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${empty}/export-inwit`,
      token: alice.token,
    });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().error.code).toBe('INWIT_EMPTY_BODY');
  });

  it('409 when not configured', async () => {
    const alice = await registerUser(app);
    const id = await createItem(alice.token, { extractedHtml: '<p>x</p>' });
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${id}/export-inwit`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INWIT_NOT_CONFIGURED');
  });
});
