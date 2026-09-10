import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('undici', () => ({ request: vi.fn() }));

import { request } from 'undici';
import { createRerankClient } from '../../src/retrieval/rerank.js';

type RequestFn = (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
const requestMock = request as unknown as ReturnType<typeof vi.fn<RequestFn>>;

function jsonResponse(status: number, payload: unknown): unknown {
  return { statusCode: status, body: { text: () => Promise.resolve(JSON.stringify(payload)) } };
}

const client = createRerankClient({
  apiKey: 'sk-test',
  baseUrl: 'https://dashscope.example.com/api/v1',
  model: 'qwen3.7-text-rerank',
});

describe('rerank client', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('posts text-rerank request and parses relevance scores', async () => {
    requestMock.mockResolvedValue(
      jsonResponse(200, {
        output: {
          results: [
            { index: 2, relevance_score: 0.91 },
            { index: 0, relevance_score: 0.42 },
          ],
        },
        usage: { total_tokens: 123 },
        request_id: 'req-9',
      }),
    );
    const results = await client.rerankTexts('怎么养胃', ['doc-a', 'doc-b', 'doc-c'], 2);
    expect(results).toEqual([
      { index: 2, score: 0.91 },
      { index: 0, score: 0.42 },
    ]);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const call = requestMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe(
      'https://dashscope.example.com/api/v1/services/rerank/text-rerank/text-rerank',
    );
    const init = call[1];
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('qwen3.7-text-rerank');
    expect(body.input).toEqual({ query: '怎么养胃', documents: ['doc-a', 'doc-b', 'doc-c'] });
    expect(body.parameters).toEqual({ top_n: 2, return_documents: false });
  });

  it('does not retry on 4xx', async () => {
    requestMock.mockResolvedValue(jsonResponse(429, { message: 'throttled' }));
    await expect(client.rerankTexts('q', ['d'], 1)).rejects.toMatchObject({
      code: 'HTTP_4XX',
      status: 429,
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on 5xx and succeeds', async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse(503, { message: 'unavailable' }))
      .mockResolvedValueOnce(
        jsonResponse(200, { output: { results: [{ index: 0, relevance_score: 0.5 }] } }),
      );
    const results = await client.rerankTexts('q', ['d'], 1);
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(results).toEqual([{ index: 0, score: 0.5 }]);
  });

  it('maps timeout to a TIMEOUT error', async () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    requestMock.mockRejectedValue(err);
    await expect(client.rerankTexts('q', ['d'], 1)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('rejects when response shape is unexpected', async () => {
    requestMock.mockResolvedValue(jsonResponse(200, { output: {} }));
    await expect(client.rerankTexts('q', ['d'], 1)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});
