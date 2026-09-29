import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { inboxExtractJobs } from '../../src/db/schema.js';
import { setExtractTransport, type ExtractTransport } from '../../src/extract/fetch.js';
import { processQueuedExtractJobs } from '../../src/inbox/extract-jobs.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

const PARA = 'Vital keeps a readable article body for later. '.repeat(8);
const articleHtml = `<!doctype html><html><head><title>Hello Article</title></head>
<body><article><h1>Hello Article</h1><p>${PARA}</p></article></body></html>`;

function mockPublicHtml(html = articleHtml): ExtractTransport {
  return {
    lookup: () => Promise.resolve({ address: '1.1.1.1', family: 4 }),
    request: () =>
      Promise.resolve({
        statusCode: 200,
        location: undefined,
        contentType: 'text/html; charset=utf-8',
        body: Buffer.from(html, 'utf8'),
      }),
  };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  setExtractTransport(mockPublicHtml());
});

afterEach(() => {
  setExtractTransport(null);
});

afterAll(async () => {
  await app.close();
});

describe('inbox extract jobs', () => {
  it('returns immediately, then a poll shows the preview, and POST /inbox stores it', async () => {
    const alice = await registerUser(app);
    const started = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox/extract-jobs',
      token: alice.token,
      payload: { url: 'https://news.example.com/a' },
    });
    expect(started.statusCode).toBe(200);
    const job = started.json();
    expect(job.status).toBe('queued');
    expect(job.preview).toBeNull();
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);

    const listed = await injectJson(app, { method: 'GET', url: '/api/v1/inbox', token: alice.token });
    expect(listed.json().items).toEqual([]);

    const queued = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/inbox/extract-jobs/${job.id}`,
      token: alice.token,
    });
    expect(queued.statusCode).toBe(200);
    expect(queued.json().status).toBe('queued');

    expect(await processQueuedExtractJobs()).toEqual({ claimed: 1 });

    const done = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/inbox/extract-jobs/${job.id}`,
      token: alice.token,
    });
    expect(done.statusCode).toBe(200);
    const preview = done.json().preview;
    expect(done.json().status).toBe('succeeded');
    expect(done.json().errorCode).toBeNull();
    expect(preview.title).toBeTruthy();
    expect(preview.contentJson).toBeTruthy();
    expect(preview.originalUrl).toBe('https://news.example.com/a');

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: {
        title: preview.title,
        originalUrl: preview.originalUrl,
        contentJson: preview.contentJson,
        extractedText: preview.extractedText,
        source: 'wechat',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().source).toBe('wechat');
    expect(created.json().contentJson).toBeTruthy();

    const again = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox/extract-jobs',
      token: alice.token,
      payload: { url: 'https://news.example.com/a' },
    });
    expect(again.json().id).toBe(job.id);
    expect(again.json().status).toBe('succeeded');
    expect(again.json().preview.title).toBe(preview.title);
  });

  it('reuses an in-flight job for the same canonical URL', async () => {
    const alice = await registerUser(app);
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox/extract-jobs',
      token: alice.token,
      payload: { url: 'https://news.example.com/a' },
    });
    const second = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox/extract-jobs',
      token: alice.token,
      payload: { url: 'https://News.example.com/a?utm_source=wechat' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    const rows = await getDb().select().from(inboxExtractJobs);
    expect(rows).toHaveLength(1);
  });

  it('hides another user and marks an empty page failed', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const started = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox/extract-jobs',
      token: alice.token,
      payload: { url: 'https://news.example.com/empty' },
    });
    const hidden = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/inbox/extract-jobs/${started.json().id}`,
      token: bob.token,
    });
    expect(hidden.statusCode).toBe(404);

    setExtractTransport(mockPublicHtml('<html><head><title>x</title></head><body>hi</body></html>'));
    expect(await processQueuedExtractJobs()).toEqual({ claimed: 1 });
    const failed = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/inbox/extract-jobs/${started.json().id}`,
      token: alice.token,
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json().status).toBe('failed');
    expect(failed.json().errorCode).toBe('EXTRACT_EMPTY');
    expect(failed.json().preview).toBeNull();

    const retry = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox/extract-jobs',
      token: alice.token,
      payload: { url: 'https://news.example.com/empty' },
    });
    expect(retry.json().id).not.toBe(started.json().id);
    expect(retry.json().status).toBe('queued');
  });

  it('fails a run that outlives the extract budget', async () => {
    const alice = await registerUser(app);
    const started = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox/extract-jobs',
      token: alice.token,
      payload: { url: 'https://news.example.com/slow' },
    });
    await getDb()
      .update(inboxExtractJobs)
      .set({ status: 'running', startedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(inboxExtractJobs.id, started.json().id));
    expect(await processQueuedExtractJobs()).toEqual({ claimed: 0 });
    const failed = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/inbox/extract-jobs/${started.json().id}`,
      token: alice.token,
    });
    expect(failed.json().status).toBe('failed');
    expect(failed.json().errorCode).toBe('EXTRACT_FAILED');
  });

  it('rejects a non-http URL before creating a job', async () => {
    const alice = await registerUser(app);
    const rejected = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox/extract-jobs',
      token: alice.token,
      payload: { url: 'file:///etc/passwd' },
    });
    expect(rejected.statusCode).toBe(400);
    const rows = await getDb().select().from(inboxExtractJobs);
    expect(rows).toHaveLength(0);
  });
});
