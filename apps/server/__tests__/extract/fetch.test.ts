import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import { MAX_RAW_HTML_BYTES, fetchHtml, setExtractTransport, type ExtractTransport, type PinnedHttpResponse } from '../../src/extract/fetch.js';
import { readBodyPrefix } from '../../src/storage/bounded-read.js';

afterEach(() => {
  setExtractTransport(null);
});

function htmlRes(html: string, status = 200): PinnedHttpResponse {
  return {
    statusCode: status,
    location: undefined,
    contentType: 'text/html; charset=utf-8',
    body: Buffer.from(html, 'utf8'),
  };
}

describe('pinned extract fetch', () => {
  it('connects to the checked address and does not re-resolve (rebinding)', async () => {
    let lookups = 0;
    const pinnedIps: string[] = [];
    const transport: ExtractTransport = {
      lookup: () => {
        lookups += 1;
        if (lookups === 1) return Promise.resolve({ address: '1.1.1.1', family: 4 });
        return Promise.resolve({ address: '127.0.0.1', family: 4 });
      },
      request: (url, pinned) => {
        pinnedIps.push(pinned.address);
        return Promise.resolve(htmlRes(`<html><body>ok ${url.hostname}</body></html>`));
      },
    };
    setExtractTransport(transport);
    const res = await fetchHtml('https://rebinder.example/');
    expect(res.html).toContain('ok');
    expect(lookups).toBe(1);
    expect(pinnedIps).toEqual(['1.1.1.1']);
  });

  it('re-checks each hop: redirect to private IP is blocked', async () => {
    const transport: ExtractTransport = {
      lookup: (hostname) => {
        if (hostname === 'public.example') return Promise.resolve({ address: '1.1.1.1', family: 4 });
        if (hostname === '127.0.0.1') return Promise.resolve({ address: '127.0.0.1', family: 4 });
        return Promise.resolve({ address: '8.8.8.8', family: 4 });
      },
      request: () =>
        Promise.resolve({
          statusCode: 302,
          location: 'http://127.0.0.1/secret',
          contentType: undefined,
          body: Buffer.alloc(0),
        }),
    };
    setExtractTransport(transport);
    await expect(fetchHtml('https://public.example/')).rejects.toBeInstanceOf(AppError);
  });

  it('re-checks each hop: redirect to mapped IPv6 loopback is blocked', async () => {
    const transport: ExtractTransport = {
      lookup: () => Promise.resolve({ address: '1.1.1.1', family: 4 }),
      request: () =>
        Promise.resolve({
          statusCode: 301,
          location: 'https://[::ffff:127.0.0.1]/',
          contentType: undefined,
          body: Buffer.alloc(0),
        }),
    };
    setExtractTransport(transport);
    await expect(fetchHtml('https://public.example/')).rejects.toBeInstanceOf(AppError);
  });

  it('caps hops at 3 redirects', async () => {
    let n = 0;
    const transport: ExtractTransport = {
      lookup: () => Promise.resolve({ address: '1.1.1.1', family: 4 }),
      request: () => {
        n += 1;
        return Promise.resolve({
          statusCode: 302,
          location: `https://public.example/h${String(n)}`,
          contentType: undefined,
          body: Buffer.alloc(0),
        });
      },
    };
    setExtractTransport(transport);
    await expect(fetchHtml('https://public.example/')).rejects.toBeInstanceOf(AppError);
    expect(n).toBe(4);
  });

  it('rejects DNS that resolves to private after a public hostname', async () => {
    const transport: ExtractTransport = {
      lookup: () => Promise.resolve({ address: '10.0.0.1', family: 4 }),
      request: () => Promise.resolve(htmlRes('<html></html>')),
    };
    setExtractTransport(transport);
    await expect(fetchHtml('https://evil.example/')).rejects.toBeInstanceOf(AppError);
  });

  it('aborts a hung DNS lookup without calling request', async () => {
    let requested = false;
    const transport: ExtractTransport = {
      lookup: () => new Promise(() => undefined),
      request: () => {
        requested = true;
        return Promise.resolve(htmlRes('<html></html>'));
      },
    };
    setExtractTransport(transport);
    const started = Date.now();
    await expect(fetchHtml('https://hang.example/', 50)).rejects.toBeInstanceOf(AppError);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(requested).toBe(false);
  });
});

describe('raw html prefix', () => {
  // eslint-disable-next-line @typescript-eslint/require-await -- 同步内存数据，仅为了满足 AsyncIterable 签名
  async function* zeros(total: number): AsyncGenerator<Uint8Array> {
    const chunk = new Uint8Array(64 * 1024);
    let left = total;
    while (left > 0) {
      const take = Math.min(chunk.byteLength, left);
      yield chunk.subarray(0, take);
      left -= take;
    }
  }

  it('keeps a document larger than the extracted-article cap', async () => {
    const size = 3 * 1024 * 1024;
    const body = await readBodyPrefix(zeros(size), MAX_RAW_HTML_BYTES);
    expect(body.length).toBe(size);
  });

  it('stops at the raw ceiling instead of rejecting the response', async () => {
    const body = await readBodyPrefix(zeros(MAX_RAW_HTML_BYTES + 50_000), MAX_RAW_HTML_BYTES);
    expect(body.length).toBe(MAX_RAW_HTML_BYTES);
  });
});
