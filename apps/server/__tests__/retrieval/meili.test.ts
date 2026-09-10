import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('undici', () => ({ request: vi.fn() }));

import { request } from 'undici';
import { createMeiliClient } from '../../src/retrieval/meili.js';

type RequestFn = (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
const requestMock = request as unknown as ReturnType<typeof vi.fn<RequestFn>>;

function jsonResponse(status: number, payload: unknown): unknown {
  return { statusCode: status, body: { text: () => Promise.resolve(JSON.stringify(payload)) } };
}

const client = createMeiliClient({
  url: 'http://meili.example.com:7700',
  apiKey: 'meili-key',
});

type Call = [string, Record<string, unknown>];

function calls(): Call[] {
  return requestMock.mock.calls as Call[];
}

function callAt(index: number): Call {
  const found = calls()[index];
  if (found === undefined) throw new Error(`expected undici call #${index}`);
  return found;
}

function bodyOf(call: Call): unknown {
  return JSON.parse(call[1].body as string) as unknown;
}

describe('meili client', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('ensureIndex creates a missing index with primaryKey id, then applies settings', async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Index `memories` not found.' }))
      .mockResolvedValue(jsonResponse(202, { taskUid: 1 }));
    await client.ensureIndex('memories');
    const getCall = callAt(0);
    const postCall = callAt(1);
    const patchCall = callAt(2);
    expect(getCall[0]).toBe('http://meili.example.com:7700/indexes/memories');
    expect(getCall[1].method).toBe('GET');
    expect((getCall[1].headers as Record<string, string>).authorization).toBe('Bearer meili-key');
    expect(postCall[0]).toBe('http://meili.example.com:7700/indexes');
    expect(postCall[1].method).toBe('POST');
    expect(bodyOf(postCall)).toEqual({ uid: 'memories', primaryKey: 'id' });
    expect(patchCall[0]).toBe('http://meili.example.com:7700/indexes/memories/settings');
    expect(patchCall[1].method).toBe('PATCH');
    expect(bodyOf(patchCall)).toEqual({
      filterableAttributes: ['userId', 'type', 'status', 'scope'],
      localizedAttributes: [{ attributePatterns: ['*'], locales: ['cmn'] }],
    });
  });

  it('ensureIndex skips creation for an existing index with a primaryKey but still applies settings', async () => {
    requestMock.mockResolvedValue(jsonResponse(200, { uid: 'tasks', primaryKey: 'id' }));
    await client.ensureIndex('tasks');
    const getCall = callAt(0);
    const patchCall = callAt(1);
    expect(getCall[1].method).toBe('GET');
    expect(patchCall[0]).toBe('http://meili.example.com:7700/indexes/tasks/settings');
    expect(patchCall[1].method).toBe('PATCH');
    expect(calls()).toHaveLength(2);
  });

  it('ensureIndex patches primaryKey when an existing index has none, then applies settings', async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse(200, { uid: 'outcomes', primaryKey: null }))
      .mockResolvedValue(jsonResponse(202, { taskUid: 9 }));
    await client.ensureIndex('outcomes');
    const getCall = callAt(0);
    const patchIndexCall = callAt(1);
    const patchSettingsCall = callAt(2);
    expect(getCall[1].method).toBe('GET');
    expect(patchIndexCall[0]).toBe('http://meili.example.com:7700/indexes/outcomes');
    expect(patchIndexCall[1].method).toBe('PATCH');
    expect(bodyOf(patchIndexCall)).toEqual({ primaryKey: 'id' });
    expect(patchSettingsCall[0]).toBe('http://meili.example.com:7700/indexes/outcomes/settings');
    expect(patchSettingsCall[1].method).toBe('PATCH');
    expect(calls()).toHaveLength(3);
  });

  it('upsertDocuments POSTs documents to the index', async () => {
    requestMock.mockResolvedValue(jsonResponse(202, { taskUid: 2 }));
    await client.upsertDocuments('tasks', [
      { id: 't1', userId: 'u1', title: '写周报' },
      { id: 't2', userId: 'u1', title: '买菜' },
    ]);
    const call = callAt(0);
    expect(call[0]).toBe('http://meili.example.com:7700/indexes/tasks/documents?primaryKey=id');
    expect(call[1].method).toBe('POST');
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer meili-key');
    expect(bodyOf(call)).toEqual([
      { id: 't1', userId: 'u1', title: '写周报' },
      { id: 't2', userId: 'u1', title: '买菜' },
    ]);
  });

  it('deleteDocuments POSTs a delete-batch of ids', async () => {
    requestMock.mockResolvedValue(jsonResponse(202, { taskUid: 3 }));
    await client.deleteDocuments('tasks', ['t1', 't2']);
    const call = callAt(0);
    expect(call[0]).toBe('http://meili.example.com:7700/indexes/tasks/documents/delete-batch');
    expect(call[1].method).toBe('POST');
    expect(bodyOf(call)).toEqual(['t1', 't2']);
  });

  it('listDocuments POSTs a documents/fetch with filter and fields', async () => {
    requestMock.mockResolvedValue(
      jsonResponse(200, { results: [{ id: 'm1' }, { id: 'm2' }], total: 2, limit: 1000, offset: 0 }),
    );
    const page = await client.listDocuments('memories', {
      filter: "userId = 'u1'",
      fields: ['id'],
      limit: 1000,
      offset: 0,
    });
    const call = callAt(0);
    expect(call[0]).toBe('http://meili.example.com:7700/indexes/memories/documents/fetch');
    expect(call[1].method).toBe('POST');
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer meili-key');
    expect(bodyOf(call)).toEqual({
      filter: "userId = 'u1'",
      fields: ['id'],
      limit: 1000,
      offset: 0,
    });
    expect(page).toEqual({ results: [{ id: 'm1' }, { id: 'm2' }], total: 2 });
  });

  it('search POSTs query with filter and returns hits', async () => {
    requestMock.mockResolvedValue(
      jsonResponse(200, { hits: [{ id: 't1', title: '写周报' }], processingTimeMs: 1 }),
    );
    const hits = await client.search('tasks', {
      q: '周报',
      filter: ['userId = "u1"'],
      limit: 10,
    });
    const call = callAt(0);
    expect(call[0]).toBe('http://meili.example.com:7700/indexes/tasks/search');
    expect(call[1].method).toBe('POST');
    expect(bodyOf(call)).toEqual({ q: '周报', filter: ['userId = "u1"'], limit: 10 });
    expect(hits).toEqual([{ id: 't1', title: '写周报' }]);
  });

  it('multiSearch groups results by indexUid', async () => {
    requestMock.mockResolvedValue(
      jsonResponse(200, {
        results: [
          { indexUid: 'tasks', hits: [{ id: 't1' }] },
          { indexUid: 'inbox', hits: [{ id: 'i1' }, { id: 'i2' }] },
        ],
      }),
    );
    const grouped = await client.multiSearch([
      { indexUid: 'tasks', q: '周报', filter: ['userId = "u1"'], limit: 5 },
      { indexUid: 'inbox', q: '周报', filter: ['userId = "u1"'], limit: 5 },
    ]);
    const call = callAt(0);
    expect(call[0]).toBe('http://meili.example.com:7700/multi-search');
    expect(call[1].method).toBe('POST');
    expect(bodyOf(call)).toEqual({
      queries: [
        { indexUid: 'tasks', q: '周报', filter: ['userId = "u1"'], limit: 5 },
        { indexUid: 'inbox', q: '周报', filter: ['userId = "u1"'], limit: 5 },
      ],
    });
    expect(grouped).toEqual({ tasks: [{ id: 't1' }], inbox: [{ id: 'i1' }, { id: 'i2' }] });
  });

  it('prefixes index uids and maps multiSearch results back to logical names', async () => {
    const prefixed = createMeiliClient({
      url: 'http://meili.example.com:7700',
      apiKey: 'meili-key',
      namePrefix: 'prod_',
    });
    requestMock
      .mockResolvedValueOnce(jsonResponse(200, { uid: 'prod_tasks', primaryKey: 'id' }))
      .mockResolvedValueOnce(jsonResponse(202, { taskUid: 1 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          results: [{ indexUid: 'prod_tasks', hits: [{ id: 't1' }] }],
        }),
      );
    await prefixed.ensureIndex('tasks');
    expect(callAt(0)[0]).toBe('http://meili.example.com:7700/indexes/prod_tasks');
    expect(callAt(1)[0]).toBe('http://meili.example.com:7700/indexes/prod_tasks/settings');
    const grouped = await prefixed.multiSearch([{ indexUid: 'tasks', q: '周报', limit: 5 }]);
    expect(bodyOf(callAt(2))).toEqual({
      queries: [{ indexUid: 'prod_tasks', q: '周报', limit: 5 }],
    });
    expect(grouped).toEqual({ tasks: [{ id: 't1' }] });
  });

  it('surfaces HTTP errors', async () => {
    requestMock.mockResolvedValue(jsonResponse(401, { message: 'bad key' }));
    await expect(client.search('tasks', { q: 'x' })).rejects.toMatchObject({ code: 'HTTP_4XX' });
  });
});
