import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './types.js';
import { bareGetInit, barePutInit, fetchPut, xhrPut } from './default-put.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bare S3 PUT', () => {
  it('bareGetInit is credentials omit with no Authorization', () => {
    const init = bareGetInit();
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toBeUndefined();
  });

  it('barePutInit is Content-Type only with credentials omit', () => {
    const body = new Blob(['x']);
    const init = barePutInit(body, 'image/png');
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(init.body).toBe(body);
    const headers = init.headers;
    expect(headers).toBeDefined();
    if (headers !== undefined && !Array.isArray(headers) && !(headers instanceof Headers)) {
      expect(headers.Authorization).toBeUndefined();
      expect(headers.Cookie).toBeUndefined();
    }
  });

  it('fetchPut does not send cookies or Authorization', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return Promise.resolve(new Response(null, { status: 200, headers: { ETag: '"e1"' } }));
    });
    const result = await fetchPut('https://s3/put', new Blob(['hi']), 'image/jpeg');
    expect(result.etag).toBe('"e1"');
    expect(calls).toHaveLength(1);
    const init = calls[0];
    expect(init?.credentials).toBe('omit');
    expect(init?.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    const headers = init?.headers;
    if (headers !== undefined && !Array.isArray(headers) && !(headers instanceof Headers)) {
      expect(headers.Authorization).toBeUndefined();
      expect(headers.Cookie).toBeUndefined();
    }
  });

  it('xhrPut never sets withCredentials and only sets Content-Type', async () => {
    const seen: { withCredentials: boolean; headers: Record<string, string> }[] = [];
    class FakeXHR {
      status = 200;
      withCredentials = true;
      upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readonly headers: Record<string, string> = {};
      open(_method: string, _url: string): void {
        /* PUT */
      }
      setRequestHeader(name: string, value: string): void {
        this.headers[name] = value;
      }
      getResponseHeader(name: string): string | null {
        return name === 'ETag' ? '"e"' : null;
      }
      send(_body: unknown): void {
        seen.push({ withCredentials: this.withCredentials, headers: { ...this.headers } });
        this.onload?.();
      }
      abort(): void {
        this.onabort?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const result = await xhrPut('https://s3/put', new Blob(['hi']), 'image/jpeg');
    expect(result.etag).toBe('"e"');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.withCredentials).toBe(false);
    expect(seen[0]?.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(seen[0]?.headers.Authorization).toBeUndefined();
    expect(seen[0]?.headers.Cookie).toBeUndefined();
  });

  it('xhrPut without XMLHttpRequest is PUT_UNAVAILABLE', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined);
    await expect(xhrPut('https://s3', new Blob(['a']), 'image/jpeg')).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(xhrPut('https://s3', new Blob(['a']), 'image/jpeg')).rejects.toMatchObject({
      code: 'PUT_UNAVAILABLE',
    });
  });
});
