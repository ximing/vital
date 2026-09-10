import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('undici', () => ({ request: vi.fn() }));

import { request } from 'undici';
import { createEmbeddingClient } from '../../src/retrieval/embedding.js';

type RequestFn = (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
const requestMock = request as unknown as ReturnType<typeof vi.fn<RequestFn>>;

function jsonResponse(status: number, payload: unknown): unknown {
  return { statusCode: status, body: { text: () => Promise.resolve(JSON.stringify(payload)) } };
}

function timeoutError(): Error {
  const err = new Error('The operation timed out');
  err.name = 'TimeoutError';
  return err;
}

const client = createEmbeddingClient({
  apiKey: 'sk-test',
  baseUrl: 'https://dashscope.example.com/api/v1',
  model: 'qwen3-vl-embedding',
  dimensions: 2560,
});

function embeddingPayload(count: number, dims = 3): unknown {
  return {
    output: {
      embeddings: Array.from({ length: count }, (_, i) => ({
        index: i,
        embedding: Array.from({ length: dims }, (_v, j) => i * 10 + j),
        type: 'text',
      })),
    },
    usage: { input_tokens: count * 7 },
    request_id: 'req-1',
  };
}

describe('embedding client', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('posts multimodal-embedding request with bearer auth and dimension parameter', async () => {
    requestMock.mockResolvedValue(jsonResponse(200, embeddingPayload(2)));
    const vectors = await client.embedTexts(['你好', 'world']);
    expect(vectors).toEqual([
      [0, 1, 2],
      [10, 11, 12],
    ]);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const call = requestMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe(
      'https://dashscope.example.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding',
    );
    const init = call[1];
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('qwen3-vl-embedding');
    expect(body.input).toEqual({ contents: [{ text: '你好' }, { text: 'world' }] });
    expect(body.parameters).toEqual({ dimension: 2560 });
  });

  it('splits batches over 20 texts and preserves input order', async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse(200, embeddingPayload(20, 1)))
      .mockResolvedValueOnce(jsonResponse(200, embeddingPayload(5, 1)));
    const texts = Array.from({ length: 25 }, (_v, i) => `t${i}`);
    const vectors = await client.embedTexts(texts);
    expect(requestMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(
      (requestMock.mock.calls[0] as [string, Record<string, unknown>])[1].body as string,
    ) as { input: { contents: unknown[] } };
    const secondBody = JSON.parse(
      (requestMock.mock.calls[1] as [string, Record<string, unknown>])[1].body as string,
    ) as { input: { contents: unknown[] } };
    expect(firstBody.input.contents).toHaveLength(20);
    expect(secondBody.input.contents).toHaveLength(5);
    expect(vectors).toHaveLength(25);
  });

  it('orders embeddings by the index field, not array position', async () => {
    requestMock.mockResolvedValue(
      jsonResponse(200, {
        output: {
          embeddings: [
            { index: 1, embedding: [9, 9] },
            { index: 0, embedding: [1, 1] },
          ],
        },
      }),
    );
    const vectors = await client.embedTexts(['a', 'b']);
    expect(vectors).toEqual([
      [1, 1],
      [9, 9],
    ]);
  });

  it('does not retry on 4xx', async () => {
    requestMock.mockResolvedValue(jsonResponse(400, { code: 'InvalidParameter', message: 'bad' }));
    await expect(client.embedTexts(['x'])).rejects.toMatchObject({ code: 'HTTP_4XX', status: 400 });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on 5xx and succeeds', async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, embeddingPayload(1)));
    const vectors = await client.embedTexts(['x']);
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(vectors).toEqual([[0, 1, 2]]);
  });

  it('retries once on network error then surfaces it', async () => {
    requestMock.mockRejectedValue(new Error('socket hang up'));
    await expect(client.embedTexts(['x'])).rejects.toMatchObject({ code: 'NETWORK' });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('maps timeout to a TIMEOUT error', async () => {
    requestMock.mockRejectedValue(timeoutError());
    await expect(client.embedTexts(['x'])).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('rejects when response shape is unexpected', async () => {
    requestMock.mockResolvedValue(jsonResponse(200, { output: {} }));
    await expect(client.embedTexts(['x'])).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});
