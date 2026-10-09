import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LookupAddress } from 'node:dns';
import { fetch as undiciFetch, request } from 'undici';
import { AppError } from '../../src/errors.js';
import { pinHttpTarget, setPinLookup, type PinLookupRecord, type PinnedTarget } from '../../src/extract/pin.js';
import { inwitRequest } from '../../src/inwit/inwit.service.js';
import { withPinnedModelFetch } from '../../src/llm/model-transport.js';
import { logger } from '../../src/utils/logger.js';

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, request: vi.fn(), fetch: vi.fn() };
});

const requestMock = request as unknown as ReturnType<typeof vi.fn>;
const fetchMock = undiciFetch as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  setPinLookup(null);
  requestMock.mockReset();
  fetchMock.mockReset();
});

function publicLookup(addresses: PinLookupRecord[]): (hostname: string) => Promise<PinLookupRecord[]> {
  return () => Promise.resolve(addresses);
}

async function invokeLookup(
  pinned: PinnedTarget,
  all: boolean,
): Promise<{ address: string | LookupAddress[]; family: number | undefined }> {
  return new Promise((resolve, reject) => {
    pinned.lookup('example.com', { all }, (err, address, family) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ address, family });
    });
  });
}

describe('request-time pin', () => {
  it('pins one public address and the connect lookup returns only that address', async () => {
    setPinLookup(
      publicLookup([
        { address: '1.1.1.1', family: 4 },
        { address: '8.8.8.8', family: 4 },
      ]),
    );
    const pinned = await pinHttpTarget('https://example.com/v1', { production: true });
    try {
      expect(pinned.url.hostname).toBe('example.com');
      expect(pinned.address).toBe('1.1.1.1');
      expect(pinned.family).toBe(4);
      await expect(invokeLookup(pinned, false)).resolves.toEqual({ address: '1.1.1.1', family: 4 });
      await expect(invokeLookup(pinned, true)).resolves.toEqual({
        address: [{ address: '1.1.1.1', family: 4 }],
        family: undefined,
      });
    } finally {
      await pinned.dispatcher.close();
    }
  });

  it('rejects a result set that contains any private address before connect', async () => {
    setPinLookup(
      publicLookup([
        { address: '1.1.1.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]),
    );
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await expect(pinHttpTarget('https://example.com/', { production: true })).rejects.toBeInstanceOf(AppError);
      await expect(pinHttpTarget('https://example.com/', { production: false })).rejects.toBeInstanceOf(AppError);
      await expect(inwitRequest(new URL('https://example.com/api/topics'), {
        method: 'GET',
        accessKey: 'k',
        timeoutMs: 10_000,
      })).rejects.toMatchObject({ status: 502, code: 'INWIT_UNREACHABLE' });
      expect(requestMock).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('10.0.0.1');
    } finally {
      warn.mockRestore();
    }
  });

  it('allows a private literal and localhost only when not production', async () => {
    let lookups = 0;
    setPinLookup((hostname) => {
      lookups += 1;
      expect(hostname).toBe('localhost');
      return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
    });
    const literal = await pinHttpTarget('http://127.0.0.1:9/x', { production: false });
    try {
      expect(literal.address).toBe('127.0.0.1');
      expect(lookups).toBe(0);
      await expect(invokeLookup(literal, false)).resolves.toEqual({ address: '127.0.0.1', family: 4 });
    } finally {
      await literal.dispatcher.close();
    }
    await expect(pinHttpTarget('http://127.0.0.1/', { production: true })).rejects.toBeInstanceOf(AppError);
    expect(lookups).toBe(0);

    const local = await pinHttpTarget('http://localhost/x', { production: false });
    try {
      expect(local.address).toBe('127.0.0.1');
      expect(lookups).toBe(1);
    } finally {
      await local.dispatcher.close();
    }
    await expect(pinHttpTarget('https://localhost/', { production: true })).rejects.toBeInstanceOf(AppError);
    expect(lookups).toBe(1);
  });

  it('rejects a public name that resolves to a private address in every environment', async () => {
    setPinLookup(publicLookup([{ address: '192.168.1.9', family: 4 }]));
    for (const production of [true, false]) {
      try {
        await pinHttpTarget('https://example.com/', { production });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const message = err instanceof Error ? err.message : '';
        expect(message).not.toContain('192.168.1.9');
        expect(message).not.toContain('example.com');
      }
    }
  });
});

describe('inwit pinned request', () => {
  it('sends the pinned dispatcher, does not follow redirects, and keeps the 10s timeout path', async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      body: { text: () => Promise.resolve('{"ok":true}') },
    });
    const ok = await inwitRequest(new URL('http://127.0.0.1:3020/api/topics'), {
      method: 'GET',
      accessKey: 'secret',
      timeoutMs: 10_000,
    });
    expect(ok).toEqual({ statusCode: 200, text: '{"ok":true}' });
    const [url, opts] = requestMock.mock.calls[0] as [
      string,
      { dispatcher: unknown; maxRedirections: number; method: string; signal: AbortSignal },
    ];
    expect(url).toBe('http://127.0.0.1:3020/api/topics');
    expect(opts.method).toBe('GET');
    expect(opts.maxRedirections).toBe(0);
    expect(opts.dispatcher).toBeTypeOf('object');
    expect(opts.signal.aborted).toBe(false);

    for (const status of [301, 302, 303, 307, 308]) {
      requestMock.mockResolvedValueOnce({
        statusCode: status,
        headers: { location: 'http://169.254.169.254/latest' },
        body: { text: () => Promise.resolve('') },
      });
      await expect(inwitRequest(new URL('http://127.0.0.1:3020/api/open/documents'), {
        method: 'POST',
        accessKey: 'secret',
        body: '{}',
        timeoutMs: 20_000,
      })).rejects.toMatchObject({ status: 502, code: 'INWIT_UNREACHABLE' });
    }
    expect(requestMock.mock.calls).toHaveLength(6);
    for (const call of requestMock.mock.calls) {
      expect(call[0]).toBe(
        call === requestMock.mock.calls[0]
          ? 'http://127.0.0.1:3020/api/topics'
          : 'http://127.0.0.1:3020/api/open/documents',
      );
      expect(String(call[0])).not.toContain('169.254.169.254');
    }
  });
});

describe('model fetch pin', () => {
  it('sets fetch for openai-completions and omits it for google adapters', () => {
    const sentinel: typeof fetch = () => Promise.reject(new Error('sentinel'));
    const signal = AbortSignal.abort();
    const completions = withPinnedModelFetch('openai-completions', {
      apiKey: 'k',
      temperature: 0.2,
      signal,
      fetch: sentinel,
      headers: { 'x-test': '1' },
    });
    expect(completions.fetch).toBeTypeOf('function');
    expect(completions.fetch).not.toBe(sentinel);
    expect(completions.apiKey).toBe('k');
    expect(completions.temperature).toBe(0.2);
    expect(completions.signal).toBe(signal);
    expect(completions.headers).toEqual({ 'x-test': '1' });

    const google = withPinnedModelFetch('google-generative-ai', {
      apiKey: 'g',
      temperature: 1,
      fetch: sentinel,
    });
    expect(google.fetch).toBeUndefined();
    expect(google.apiKey).toBe('g');
    expect(google.temperature).toBe(1);

    const vertex = withPinnedModelFetch('google-vertex', { fetch: sentinel, apiKey: 'v' });
    expect(vertex.fetch).toBeUndefined();
    expect(vertex.apiKey).toBe('v');
  });

  it('fails a pinned model fetch on 3xx instead of following Location', async () => {
    setPinLookup(publicLookup([{ address: '1.1.1.1', family: 4 }]));
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }),
    );
    const fetchFn = withPinnedModelFetch('openai-completions', { apiKey: 'k' }).fetch;
    if (fetchFn === undefined) throw new Error('missing fetch');
    try {
      await fetchFn('https://example.com/v1/chat/completions');
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ status: 502, code: 'LLM_UNAVAILABLE' });
      const message = err instanceof Error ? err.message : '';
      expect(message).not.toContain('127.0.0.1');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [string, { redirect?: string; dispatcher?: unknown }];
    expect(target).toBe('https://example.com/v1/chat/completions');
    expect(init.redirect).toBe('manual');
    expect(init.dispatcher).toBeTypeOf('object');
  });
});
