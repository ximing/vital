import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('undici', () => ({ request: vi.fn() }));

import { request } from 'undici';
import { createQdrantClient } from '../../src/retrieval/qdrant.js';

type RequestFn = (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
const requestMock = request as unknown as ReturnType<typeof vi.fn<RequestFn>>;

function jsonResponse(status: number, payload: unknown): unknown {
  return { statusCode: status, body: { text: () => Promise.resolve(JSON.stringify(payload)) } };
}

const client = createQdrantClient({
  url: 'http://qdrant.example.com:6333',
  apiKey: 'qdrant-key',
  vectorSize: 2560,
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

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

describe('qdrant client', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('ensureCollection creates the collection with cosine vectors when missing, then payload indexes', async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse(404, { status: { error: 'Not found' } }))
      .mockResolvedValue(jsonResponse(200, { result: true }));
    await client.ensureCollection('agent_memory');
    const getCall = callAt(0);
    const putCall = callAt(1);
    const indexCalls = calls().slice(2);
    expect(getCall[0]).toBe('http://qdrant.example.com:6333/collections/agent_memory');
    expect(getCall[1].method).toBe('GET');
    expect((getCall[1].headers as Record<string, string>)['api-key']).toBe('qdrant-key');
    expect(putCall[0]).toBe('http://qdrant.example.com:6333/collections/agent_memory');
    expect(putCall[1].method).toBe('PUT');
    expect(bodyOf(putCall)).toEqual({ vectors: { size: 2560, distance: 'Cosine' } });
    expect(indexCalls).toHaveLength(3);
    const indexed = indexCalls.map((c) => bodyOf(c));
    expect(indexed).toEqual([
      { field_name: 'userId', field_schema: 'keyword' },
      { field_name: 'scope', field_schema: 'keyword' },
      { field_name: 'status', field_schema: 'keyword' },
    ]);
    for (const c of indexCalls) {
      expect(c[0]).toBe('http://qdrant.example.com:6333/collections/agent_memory/index');
      expect(c[1].method).toBe('PUT');
    }
  });

  it('ensureCollection skips creation when the collection exists but still ensures indexes', async () => {
    requestMock.mockResolvedValue(jsonResponse(200, { result: { status: 'green' } }));
    await client.ensureCollection('tasks');
    const getCall = callAt(0);
    const rest = calls().slice(1);
    expect(getCall[1].method).toBe('GET');
    expect(rest).toHaveLength(3);
    expect(rest.every((c) => c[0].endsWith('/collections/tasks/index'))).toBe(true);
  });

  it('prefixes collection names so environments can share a cluster', async () => {
    const prefixed = createQdrantClient({
      url: 'http://qdrant.example.com:6333',
      apiKey: 'qdrant-key',
      vectorSize: 2560,
      namePrefix: 'dev_',
    });
    requestMock.mockResolvedValue(jsonResponse(200, { result: { status: 'green' } }));
    await prefixed.ensureCollection('tasks');
    expect(callAt(0)[0]).toBe('http://qdrant.example.com:6333/collections/dev_tasks');
    expect(calls().slice(1).every((c) => c[0].endsWith('/collections/dev_tasks/index'))).toBe(
      true,
    );
  });

  it('ensureCollection surfaces unexpected GET errors', async () => {
    requestMock.mockResolvedValue(jsonResponse(500, { status: { error: 'boom' } }));
    await expect(client.ensureCollection('x')).rejects.toMatchObject({ code: 'HTTP_5XX' });
  });

  it('upsertPoints PUTs points with wait=true', async () => {
    requestMock.mockResolvedValue(jsonResponse(200, { result: { status: 'acknowledged' } }));
    await client.upsertPoints('agent_memory', [
      { id: 'mem-1', vector: [0.1, 0.2], payload: { userId: 'u1', scope: ['all'] } },
    ]);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const call = callAt(0);
    expect(call[0]).toBe('http://qdrant.example.com:6333/collections/agent_memory/points?wait=true');
    expect(call[1].method).toBe('PUT');
    expect(bodyOf(call)).toEqual({
      points: [{ id: 'mem-1', vector: [0.1, 0.2], payload: { userId: 'u1', scope: ['all'] } }],
    });
  });

  it('queryPoints POSTs a vector query with filter and maps scored points', async () => {
    requestMock.mockResolvedValue(
      jsonResponse(200, {
        result: {
          points: [
            { id: 'mem-1', score: 0.88, payload: { userId: 'u1' } },
            { id: 'mem-2', score: 0.71, payload: { userId: 'u1' } },
          ],
        },
      }),
    );
    const filter = { must: [{ key: 'userId', match: { value: 'u1' } }] };
    const hits = await client.queryPoints('agent_memory', [0.3, 0.4], filter, 5);
    const call = callAt(0);
    expect(call[0]).toBe(
      'http://qdrant.example.com:6333/collections/agent_memory/points/query',
    );
    expect(call[1].method).toBe('POST');
    expect(bodyOf(call)).toEqual({ query: [0.3, 0.4], filter, limit: 5, with_payload: true });
    expect(hits).toEqual([
      { id: 'mem-1', score: 0.88, payload: { userId: 'u1' } },
      { id: 'mem-2', score: 0.71, payload: { userId: 'u1' } },
    ]);
  });

  it('deletePoints POSTs ids with wait=true', async () => {
    requestMock.mockResolvedValue(jsonResponse(200, { result: { status: 'acknowledged' } }));
    await client.deletePoints('agent_memory', ['mem-1', 'mem-2']);
    const call = callAt(0);
    expect(call[0]).toBe(
      'http://qdrant.example.com:6333/collections/agent_memory/points/delete?wait=true',
    );
    expect(call[1].method).toBe('POST');
    expect(bodyOf(call)).toEqual({ points: ['mem-1', 'mem-2'] });
  });

  it('scrollPoints paginates until next_page_offset is null', async () => {
    requestMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          result: {
            points: [{ id: 'a', payload: { userId: 'u1' }, vector: [1, 2] }],
            next_page_offset: 'b',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          result: {
            points: [{ id: 'b', payload: { userId: 'u1' }, vector: [3, 4] }],
            next_page_offset: null,
          },
        }),
      );
    const filter = { must: [{ key: 'userId', match: { value: 'u1' } }] };
    const points = await client.scrollPoints('agent_memory', filter, { withVector: true });
    expect(requestMock).toHaveBeenCalledTimes(2);
    const first = bodyOf(callAt(0));
    expect(first.with_vector).toBe(true);
    expect(first.with_payload).toBe(true);
    expect(first.filter).toEqual(filter);
    expect('offset' in first).toBe(false);
    const second = bodyOf(callAt(1));
    expect(second.offset).toBe('b');
    expect(points).toEqual([
      { id: 'a', payload: { userId: 'u1' }, vector: [1, 2] },
      { id: 'b', payload: { userId: 'u1' }, vector: [3, 4] },
    ]);
  });

  it('scrollPoints omits vectors by default', async () => {
    requestMock.mockResolvedValue(
      jsonResponse(200, {
        result: { points: [{ id: 'a', payload: {} }], next_page_offset: null },
      }),
    );
    const points = await client.scrollPoints('c', undefined);
    expect(bodyOf(callAt(0)).with_vector).toBe(false);
    expect(points).toEqual([{ id: 'a', payload: {} }]);
  });

  it('surfaces HTTP errors from point operations', async () => {
    requestMock.mockResolvedValue(jsonResponse(400, { status: { error: 'bad filter' } }));
    await expect(client.queryPoints('c', [1], undefined, 1)).rejects.toMatchObject({
      code: 'HTTP_4XX',
    });
  });
});
