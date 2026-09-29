import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { inboxItems } from '../../src/db/schema.js';
import { setExtractTransport, type ExtractTransport } from '../../src/extract/fetch.js';
import { OBSCURA_WAIT_SEC, ObscuraUnavailable, setObscuraRunner } from '../../src/extract/obscura.js';
import { backfillLinkOnlyInbox, resetLinkExtractForTests } from '../../src/inbox/link-extract.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

const PARA = 'Vital keeps a readable article body for later. '.repeat(8);

function articleHtml(title: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${PARA}</p></article></body></html>`;
}

function shellHtml(): string {
  return '<html><head><title>App</title></head><body><div id="root"></div></body></html>';
}

const publicDns: ExtractTransport = {
  lookup: () => Promise.resolve({ address: '1.1.1.1', family: 4 }),
  request: () => Promise.reject(new Error('plain http should not run')),
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  resetLinkExtractForTests();
  setExtractTransport(publicDns);
  setObscuraRunner(null);
});

afterEach(() => {
  setExtractTransport(null);
  setObscuraRunner(null);
  resetLinkExtractForTests();
});

afterAll(async () => {
  await app.close();
});

async function saveLink(token: string, url: string, title: string): Promise<string> {
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/inbox',
    token,
    payload: { title, originalUrl: url, source: 'web' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe('link-only inbox backfill', () => {
  it('fills an empty body and does not fetch it again', async () => {
    const alice = await registerUser(app);
    const url = 'https://news.example/backfill';
    const id = await saveLink(alice.token, url, url);
    let calls = 0;
    setObscuraRunner((req) => {
      calls += 1;
      expect(req.waitSec).toBe(OBSCURA_WAIT_SEC);
      return Promise.resolve({ href: url, title: 'Backfill title', html: articleHtml('Backfill title') });
    });

    const first = await backfillLinkOnlyInbox();
    expect(first).toEqual({ claimed: 1, filled: 1 });
    const got = await injectJson(app, { method: 'GET', url: `/api/v1/inbox/${id}`, token: alice.token });
    expect(got.statusCode).toBe(200);
    expect(got.json().title).toBe('Backfill title');
    expect(got.json().extractedText).toContain('readable article body');
    expect(got.json().contentJson.content.length).toBeGreaterThan(0);

    const second = await backfillLinkOnlyInbox();
    expect(second).toEqual({ claimed: 0, filled: 0 });
    expect(calls).toBe(1);
  });

  it('keeps a typed title and skips items that already have a body', async () => {
    const alice = await registerUser(app);
    const url = 'https://news.example/named';
    const named = await saveLink(alice.token, url, '我的标题');
    const filled = await saveLink(alice.token, 'https://news.example/has-body', 'Already');
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/inbox/${filled}`,
      token: alice.token,
      payload: { extractedText: PARA + PARA },
    });
    const calls: string[] = [];
    setObscuraRunner((req) => {
      calls.push(req.url);
      return Promise.resolve({ href: req.url, title: 'Parsed', html: articleHtml('Parsed') });
    });

    const result = await backfillLinkOnlyInbox();
    expect(result.filled).toBe(1);
    expect(calls).toEqual([url]);
    const got = await injectJson(app, { method: 'GET', url: `/api/v1/inbox/${named}`, token: alice.token });
    expect(got.json().title).toBe('我的标题');
    expect(got.json().extractedText).toContain('readable article body');
  });

  it('marks a thin render so the next heal skips it', async () => {
    const alice = await registerUser(app);
    const id = await saveLink(alice.token, 'https://app.example/thin', 'https://app.example/thin');
    let calls = 0;
    setObscuraRunner(() => {
      calls += 1;
      return Promise.resolve({
        href: 'https://app.example/thin',
        title: 'App',
        html: shellHtml(),
      });
    });
    const first = await backfillLinkOnlyInbox();
    expect(first).toEqual({ claimed: 1, filled: 0 });
    expect(calls).toBe(2);
    const row = await getDb().select().from(inboxItems).where(eq(inboxItems.id, id)).limit(1);
    expect(row[0]?.linkExtractAttemptedAt).toBeInstanceOf(Date);
    const second = await backfillLinkOnlyInbox();
    expect(second).toEqual({ claimed: 0, filled: 0 });
    expect(calls).toBe(2);
  });

  it('clears the attempt and pauses when Obscura is not installed', async () => {
    const alice = await registerUser(app);
    const id = await saveLink(alice.token, 'https://app.example/later', 'https://app.example/later');
    setObscuraRunner(() => Promise.reject(new ObscuraUnavailable('obscura not found', 'missing')));
    setExtractTransport({
      lookup: () => Promise.resolve({ address: '1.1.1.1', family: 4 }),
      request: () =>
        Promise.resolve({
          statusCode: 200,
          location: undefined,
          contentType: 'text/html',
          body: Buffer.from(shellHtml(), 'utf8'),
        }),
    });
    const missing = await backfillLinkOnlyInbox();
    expect(missing).toEqual({ claimed: 1, filled: 0 });
    const cleared = await getDb().select().from(inboxItems).where(eq(inboxItems.id, id)).limit(1);
    expect(cleared[0]?.linkExtractAttemptedAt).toBeNull();
    const paused = await backfillLinkOnlyInbox();
    expect(paused).toEqual({ claimed: 0, filled: 0 });
  });
});
