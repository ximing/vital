import { randomUUID } from 'node:crypto';
import type { InboxPreview } from '@vital/dto';
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

  it('lists the current user without a preview and without starting work', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app, 'bob');
    const secret = { title: 'preview-secret-do-not-leak' } as InboxPreview;
    const runningId = randomUUID();
    const queuedId = randomUUID();
    const failedId = randomUUID();
    const succeededId = randomUUID();
    await getDb().insert(inboxExtractJobs).values([
      {
        id: runningId,
        userId: alice.id,
        url: 'https://news.example.com/running',
        canonicalUrl: 'https://news.example.com/running',
        status: 'running',
        startedAt: new Date('2026-09-06T09:00:00.000Z'),
        createdAt: new Date('2026-09-06T07:00:00.000Z'),
      },
      {
        id: queuedId,
        userId: alice.id,
        url: 'https://news.example.com/queued',
        canonicalUrl: 'https://news.example.com/queued',
        status: 'queued',
        createdAt: new Date('2026-09-06T08:00:00.000Z'),
      },
      {
        id: failedId,
        userId: alice.id,
        url: 'https://news.example.com/empty',
        canonicalUrl: 'https://news.example.com/empty',
        status: 'failed',
        errorCode: 'EXTRACT_EMPTY',
        finishedAt: new Date('2026-09-06T11:00:00.000Z'),
        createdAt: new Date('2026-09-06T06:00:00.000Z'),
      },
      {
        id: succeededId,
        userId: alice.id,
        url: 'https://news.example.com/done',
        canonicalUrl: 'https://news.example.com/done',
        status: 'succeeded',
        preview: secret,
        finishedAt: new Date('2026-09-06T10:00:00.000Z'),
        createdAt: new Date('2026-09-06T05:00:00.000Z'),
      },
      {
        id: randomUUID(),
        userId: bob.id,
        url: 'https://news.example.com/bob',
        canonicalUrl: 'https://news.example.com/bob',
        status: 'queued',
      },
    ]);

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/inbox/extract-jobs',
      token: alice.token,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ page: 1, pageSize: 20, total: 4, activeCount: 2 });
    const items = listed.json().items as Array<{
      id: string;
      url: string;
      status: string;
      errorCode: string | null;
      startedAt: string | null;
      finishedAt: string | null;
    }>;
    expect(items.map((item) => item.status)).toEqual(['running', 'queued', 'failed', 'succeeded']);
    expect(items.map((item) => item.id)).toEqual([runningId, queuedId, failedId, succeededId]);
    expect(items[0]?.startedAt).toBe('2026-09-06T09:00:00.000Z');
    expect(items[0]?.errorCode).toBeNull();
    expect(items[2]?.errorCode).toBe('EXTRACT_EMPTY');
    expect(items[2]?.finishedAt).toBe('2026-09-06T11:00:00.000Z');
    expect(JSON.stringify(items)).not.toContain('preview');
    expect(JSON.stringify(items)).not.toContain('preview-secret-do-not-leak');
    expect(items.some((item) => item.url.includes('/bob'))).toBe(false);
    expect(JSON.stringify(listed.json())).not.toContain('preview');

    const page = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/inbox/extract-jobs?page=2&limit=2',
      token: alice.token,
    });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({ page: 2, pageSize: 2, total: 4, activeCount: 2 });
    expect((page.json().items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      failedId,
      succeededId,
    ]);

    const queued = await getDb()
      .select({ status: inboxExtractJobs.status })
      .from(inboxExtractJobs)
      .where(eq(inboxExtractJobs.id, queuedId));
    expect(queued[0]?.status).toBe('queued');
  });

  it('pages finished history without dropping in-flight jobs or starting work', async () => {
    const alice = await registerUser(app);
    const runningId = randomUUID();
    const oldestId = randomUUID();
    const finished = Array.from({ length: 50 }, (_, index) => ({
      id: index === 0 ? oldestId : randomUUID(),
      userId: alice.id,
      url: `https://news.example.com/old-${index}`,
      canonicalUrl: `https://news.example.com/old-${index}`,
      status: 'succeeded' as const,
      finishedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)),
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)),
    }));
    await getDb()
      .insert(inboxExtractJobs)
      .values([
        {
          id: runningId,
          userId: alice.id,
          url: 'https://news.example.com/running',
          canonicalUrl: 'https://news.example.com/running',
          status: 'running',
          startedAt: new Date('2026-09-06T09:00:00.000Z'),
          createdAt: new Date('2026-09-06T09:00:00.000Z'),
        },
        ...finished,
      ]);

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/inbox/extract-jobs',
      token: alice.token,
    });
    expect(listed.json()).toMatchObject({ page: 1, pageSize: 20, total: 51, activeCount: 1 });
    const items = listed.json().items as Array<{ id: string; status: string }>;
    expect(items).toHaveLength(20);
    expect(items[0]?.id).toBe(runningId);
    expect(items.some((item) => item.id === oldestId)).toBe(false);
    expect(JSON.stringify(listed.json())).not.toContain('preview');

    const last = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/inbox/extract-jobs?page=3&limit=20',
      token: alice.token,
    });
    const lastItems = last.json().items as Array<{ id: string }>;
    expect(last.json()).toMatchObject({ page: 3, pageSize: 20, total: 51, activeCount: 1 });
    expect(lastItems).toHaveLength(11);
    expect(lastItems.some((item) => item.id === oldestId)).toBe(true);

    const past = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/inbox/extract-jobs?page=4&limit=20',
      token: alice.token,
    });
    expect(past.json()).toMatchObject({ page: 4, pageSize: 20, total: 51, activeCount: 1, items: [] });

    const running = await getDb()
      .select({ status: inboxExtractJobs.status })
      .from(inboxExtractJobs)
      .where(eq(inboxExtractJobs.id, runningId));
    expect(running[0]?.status).toBe('running');
  });

  it('rejects an extract job page outside 1..10000 or a limit above 100', async () => {
    const alice = await registerUser(app);
    const badPage = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/inbox/extract-jobs?page=0',
      token: alice.token,
    });
    expect(badPage.statusCode).toBe(400);
    const badLimit = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/inbox/extract-jobs?limit=101',
      token: alice.token,
    });
    expect(badLimit.statusCode).toBe(400);
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
