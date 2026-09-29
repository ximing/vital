import { MAX_EXTRACT_HTML_BYTES } from '@vital/dto';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import { parseRenderedArticle } from '../../src/extract/article.js';
import { setExtractTransport, type ExtractTransport } from '../../src/extract/fetch.js';
import { extractUrl } from '../../src/extract/extract.js';
import {
  OBSCURA_RETRY_WAIT_SEC,
  OBSCURA_WAIT_SEC,
  ObscuraUnavailable,
  obscuraArgs,
  obscuraProcessEnv,
  setObscuraRunner,
  type ObscuraFetchRequest,
  type ObscuraPage,
} from '../../src/extract/obscura.js';

const PARA = 'Vital keeps a readable article body for later. '.repeat(8);

function articleHtml(title = 'Rendered article'): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${PARA}</p></article></body></html>`;
}

function publicDns(request?: ExtractTransport['request']): ExtractTransport {
  return {
    lookup: () => Promise.resolve({ address: '1.1.1.1', family: 4 }),
    request:
      request ??
      (() => Promise.reject(new Error('plain http should not run'))),
  };
}

afterEach(() => {
  setObscuraRunner(null);
  setExtractTransport(null);
});

describe('obscura argv', () => {
  it('waits for JS and does not open private networks', () => {
    const args = obscuraArgs('https://news.example/a', OBSCURA_WAIT_SEC, 20);
    expect(args).toContain('--quiet');
    expect(args).toContain('--wait');
    expect(args).toContain(String(OBSCURA_WAIT_SEC));
    expect(args).toContain('--wait-until');
    expect(args).toContain('domcontentloaded');
    expect(args).not.toContain('--allow-private-network');
    expect(args).not.toContain('--stealth');
    expect(args).not.toContain('--dump');
    expect(args).not.toContain('--proxy');
    const evalSource = args[args.indexOf('--eval') + 1] ?? '';
    expect(evalSource).toContain('script, style, noscript');
    expect(evalSource).toContain('outerHTML');
  });
});

describe('obscura process env', () => {
  it('connects directly and bounds a stuck first paint', () => {
    const env = obscuraProcessEnv(20, OBSCURA_WAIT_SEC, {
      PATH: '/usr/bin',
      http_proxy: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      ALL_PROXY: 'http://127.0.0.1:7890',
      OBSCURA_PROXY: 'http://127.0.0.1:7890',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.http_proxy).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.ALL_PROXY).toBeUndefined();
    expect(env.OBSCURA_PROXY).toBeUndefined();
    expect(env.OBSCURA_NAV_TIMEOUT_MS).toBe('20000');
    expect(env.OBSCURA_FETCH_TIMEOUT_MS).toBe('2000');
    expect(env.OBSCURA_SCRIPT_DEADLINE_MS).toBe('4000');
  });

  it('relaxes the script budget on the longer retry', () => {
    const env = obscuraProcessEnv(25, OBSCURA_RETRY_WAIT_SEC, {});
    expect(env.OBSCURA_FETCH_TIMEOUT_MS).toBe('12000');
    expect(env.OBSCURA_SCRIPT_DEADLINE_MS).toBe('20000');
  });
});

describe('oversized raw html', () => {
  it('extracts the article when scripts push the document past 2MB', () => {
    const html = `<!doctype html><html><head><title>页面标题</title><script>${'v'.repeat(MAX_EXTRACT_HTML_BYTES)}</script></head><body><h1 id="activity-name">微信标题</h1><div id="js_content"><p>${PARA}</p></div></body></html>`;
    expect(html.length).toBeGreaterThan(MAX_EXTRACT_HTML_BYTES);
    const parsed = parseRenderedArticle(html, new URL('https://mp.weixin.qq.com/s/abc'), '页面标题');
    expect(parsed.useful).toBe(true);
    expect(parsed.title).toBe('微信标题');
    expect(parsed.text ?? '').toContain('readable article body');
    expect(parsed.text?.length ?? 0).toBeLessThan(MAX_EXTRACT_HTML_BYTES);
  });
});

describe('extractUrl rendered fallback', () => {
  it('parses Obscura HTML with the shared article pipeline and skips plain HTTP', async () => {
    const calls: number[] = [];
    setExtractTransport(publicDns());
    setObscuraRunner((req) => {
      calls.push(req.waitSec);
      return Promise.resolve({
        href: 'https://news.example/a',
        title: 'Rendered article',
        html: articleHtml(),
      });
    });
    const preview = await extractUrl('https://news.example/a');
    expect(calls).toEqual([OBSCURA_WAIT_SEC]);
    expect(preview.title).toBe('Rendered article');
    expect(preview.extractedText ?? '').toContain('readable article body');
    expect(preview.contentJson?.content.length).toBeGreaterThan(0);
    expect(preview.assets).toEqual([]);
    expect(preview.originalUrl).toBe('https://news.example/a');
  });

  it('uses a site extractor title instead of the document title', async () => {
    setExtractTransport(publicDns());
    setObscuraRunner(() =>
      Promise.resolve({
        href: 'https://mp.weixin.qq.com/s/abc',
        title: '页面标题',
        html: `<!doctype html><html><head><title>页面标题</title></head><body>
          <h1 id="activity-name">微信标题</h1>
          <div id="js_content"><p>${PARA}</p></div>
        </body></html>`,
      }),
    );
    const preview = await extractUrl('https://mp.weixin.qq.com/s/abc');
    expect(preview.title).toBe('微信标题');
    expect(preview.extractedText ?? '').toContain('readable article body');
  });

  it('retries once when the first render is a shell and does not fall back to plain HTTP', async () => {
    const waits: number[] = [];
    setExtractTransport(publicDns());
    setObscuraRunner((req) => {
      waits.push(req.waitSec);
      const html = waits.length === 1 ? '<html><head><title>App</title></head><body><div id="root"></div></body></html>' : articleHtml('After wait');
      return Promise.resolve({ href: 'https://app.example/item', title: 'App', html });
    });
    const preview = await extractUrl('https://app.example/item');
    expect(waits).toEqual([OBSCURA_WAIT_SEC, OBSCURA_RETRY_WAIT_SEC]);
    expect(preview.title).toBe('After wait');
    expect(preview.contentJson).not.toBeNull();
  });

  it('leaves a still-empty shell empty after the retry', async () => {
    let calls = 0;
    setExtractTransport(publicDns());
    setObscuraRunner(() => {
      calls += 1;
      return Promise.resolve({
        href: 'https://app.example/item',
        title: 'App',
        html: '<html><head><title>App</title></head><body><div id="root"></div></body></html>',
      });
    });
    const preview = await extractUrl('https://app.example/item');
    expect(calls).toBe(2);
    expect(preview.extractedText).toBeNull();
    expect(preview.contentJson).toBeNull();
    expect(preview.title).toBe('App');
  });

  it('does not keep a challenge page', async () => {
    let calls = 0;
    setExtractTransport(publicDns());
    setObscuraRunner(() => {
      calls += 1;
      return Promise.resolve({
        href: 'https://news.example/a',
        title: 'Just a moment...',
        html: `<html><head><title>Just a moment...</title></head><body><div class="cf-turnstile"></div><p>${PARA}</p></body></html>`,
      });
    });
    const preview = await extractUrl('https://news.example/a');
    expect(calls).toBe(2);
    expect(preview.extractedText).toBeNull();
    expect(preview.contentJson).toBeNull();
    expect(preview.title).toBe('news.example');
  });

  it('drops a site-extractor miss that is mostly links', async () => {
    const link = `<a href="/n">Nav link number with plenty of anchor text for the density check.</a>`;
    setExtractTransport(publicDns());
    setObscuraRunner(() =>
      Promise.resolve({
        href: 'https://news.example/links',
        title: 'Links',
        html: `<html><head><title>Links</title></head><body>${link.repeat(8)}</body></html>`,
      }),
    );
    const preview = await extractUrl('https://news.example/links');
    expect(preview.extractedText).toBeNull();
    expect(preview.contentJson).toBeNull();
  });

  it('uses plain HTTP when Obscura is missing', async () => {
    let requests = 0;
    setExtractTransport(
      publicDns(() => {
        requests += 1;
        return Promise.resolve({
          statusCode: 200,
          location: undefined,
          contentType: 'text/html',
          body: Buffer.from(articleHtml('Static article'), 'utf8'),
        });
      }),
    );
    setObscuraRunner(() => Promise.reject(new ObscuraUnavailable('obscura not found', 'missing')));
    const preview = await extractUrl('https://news.example/static');
    expect(requests).toBe(1);
    expect(preview.title).toBe('Static article');
    expect(preview.extractedText ?? '').toContain('readable article body');
  });

  it('keeps the rendered shell when the longer wait crashes', async () => {
    let calls = 0;
    let requests = 0;
    setExtractTransport(
      publicDns(() => {
        requests += 1;
        return Promise.reject(new Error('plain http should not run'));
      }),
    );
    setObscuraRunner((req: ObscuraFetchRequest) => {
      calls += 1;
      if (req.waitSec === OBSCURA_WAIT_SEC) {
        return Promise.resolve({
          href: 'https://app.example/item',
          title: 'App',
          html: '<html><head><title>App</title></head><body><div id="root"></div></body></html>',
        } satisfies ObscuraPage);
      }
      return Promise.reject(new ObscuraUnavailable('obscura exited 1', 'failed'));
    });
    const preview = await extractUrl('https://app.example/item');
    expect(calls).toBe(2);
    expect(requests).toBe(0);
    expect(preview.contentJson).toBeNull();
    expect(preview.title).toBe('App');
  });

  it('rejects a private URL before starting Obscura', async () => {
    let calls = 0;
    setObscuraRunner(() => {
      calls += 1;
      return Promise.resolve({ href: 'http://127.0.0.1/', title: '', html: articleHtml() });
    });
    await expect(extractUrl('http://127.0.0.1/secret')).rejects.toBeInstanceOf(AppError);
    await expect(extractUrl('http://localhost/secret')).rejects.toBeInstanceOf(AppError);
    expect(calls).toBe(0);
  });

  it('rejects a render that lands on a private address', async () => {
    let requests = 0;
    setExtractTransport(
      publicDns(() => {
        requests += 1;
        return Promise.reject(new Error('plain http should not run'));
      }),
    );
    setObscuraRunner(() =>
      Promise.resolve({
        href: 'http://127.0.0.1/secret',
        title: 'secret',
        html: articleHtml(),
      }),
    );
    await expect(extractUrl('https://news.example/go')).rejects.toBeInstanceOf(AppError);
    expect(requests).toBe(0);
  });

  it('rejects a hostname that resolves to a private address', async () => {
    let calls = 0;
    setExtractTransport({
      lookup: () => Promise.resolve({ address: '10.1.1.1', family: 4 }),
      request: () => Promise.reject(new Error('must not fetch')),
    });
    setObscuraRunner(() => {
      calls += 1;
      return Promise.resolve({ href: 'https://rebind.example/', title: '', html: articleHtml() });
    });
    await expect(extractUrl('https://rebind.example/')).rejects.toBeInstanceOf(AppError);
    expect(calls).toBe(0);
  });
});
