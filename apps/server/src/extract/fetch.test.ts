import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { fetchHtml, setExtractTransport, type ExtractTransport, type PinnedHttpResponse } from './fetch.js';

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
