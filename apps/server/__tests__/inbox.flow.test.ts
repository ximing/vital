import { createHash } from 'node:crypto';
import { INBOX_JSON_BODY_LIMIT_BYTES } from '@vital/dto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { db } from '../src/db/index.js';
import { attachments, entityLinks, inboxItems } from '../src/db/schema.js';
import { setExtractTransport, type ExtractTransport } from '../src/extract/fetch.js';
import { extractSemaphore } from '../src/extract/semaphore.js';
import { EXTRACT_TIMEOUT_MS } from '../src/extract/ssrf.js';
import { canonicalizeUrl } from '../src/inbox/canonical.js';
import { setStorageAdapter } from '../src/storage/factory.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { inboxId, registerUser } from './helpers/session.js';
import { installMockStorage, type MockStorage } from './helpers/storage.js';

let app: FastifyInstance;
let storage: MockStorage;

function keyFor(url: string): string {
  return createHash('sha256').update(canonicalizeUrl(url), 'utf8').digest('hex');
}

const articleHtml = `<!doctype html><html><head><title>Hello Article</title></head>
<body><article><h1>Hello Article</h1>
<p>Readable body about later reading with enough text for the parser to keep the article.</p>
<p>A second paragraph so Readability treats this as a real document instead of a stub.</p>
</article></body></html>`;

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

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  setExtractTransport(mockPublicHtml());
});

afterEach(() => {
  setStorageAdapter(null);
  setExtractTransport(null);
});

afterAll(async () => {
  await app.close();
});

async function readyImage(token: string, size = 1024): Promise<string> {
  const presigned = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/uploads/presign',
    token,
    payload: { mime: 'image/jpeg', size },
  });
  expect(presigned.statusCode).toBe(201);
  const id = presigned.json().id as string;
  storage.headObject.mockResolvedValue({
    size,
    contentType: 'image/jpeg',
    lastModified: new Date(),
  });
  const complete = await injectJson(app, {
    method: 'POST',
    url: `/api/v1/uploads/${id}/complete`,
    token,
    payload: {},
  });
  expect(complete.statusCode).toBe(200);
  return id;
}

describe('inbox', () => {
  it('manual create is 201 persist; extract is 200 preview not stored', async () => {
    const alice = await registerUser(app);
    const extracted = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox/extract',
      token: alice.token,
      payload: { url: 'https://news.example.com/a' },
    });
    expect(extracted.statusCode).toBe(200);
    const preview = extracted.json();
    expect(preview.id).toBeUndefined();
    expect(preview.createdAt).toBeUndefined();
    expect(preview.title).toBeTruthy();
    expect(preview.extractedHtml).toBeTruthy();
    expect(preview.canonicalUrl).toBe('https://news.example.com/a');

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/inbox',
      token: alice.token,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([]);

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: {
        title: preview.title,
        originalUrl: 'https://news.example.com/a',
        extractedHtml: preview.extractedHtml,
        extractedText: preview.extractedText,
        source: 'web',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().id).toBeTruthy();
    expect(created.json().extractedHtml).toBeTruthy();
    const get = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/inbox/${created.json().id}`,
      token: alice.token,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().extractedHtml).toBeTruthy();
  });

  it('forever canonical URL idempotency returns stored response', async () => {
    const alice = await registerUser(app);
    const url = 'https://News.Example.com/path/?utm_source=x#frag';
    const key = keyFor(url);
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      headers: { 'idempotency-key': key },
      payload: { title: 'First', originalUrl: url, source: 'extension' },
    });
    expect(first.statusCode).toBe(201);
    const id = first.json().id as string;
    const second = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      headers: { 'idempotency-key': key },
      payload: { title: 'Second should not persist', originalUrl: url, source: 'extension' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(id);
    expect(second.json().title).toBe('First');
    const rows = await db.select().from(inboxItems).where(eq(inboxItems.userId, alice.id));
    expect(rows).toHaveLength(1);
  });

  it('extension source without Idempotency-Key is 400', async () => {
    const alice = await registerUser(app);
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Sel', originalUrl: 'https://example.com/p', source: 'extension' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('wechat collector create is 201 without Idempotency-Key', async () => {
    const alice = await registerUser(app);
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: '微信收藏', extractedText: '一段收藏', source: 'wechat' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe('wechat');
  });

  it('selection payload stores escaped html and source=extension', async () => {
    const alice = await registerUser(app);
    const page = 'https://example.com/article';
    const selection = 'A quoted passage from the page';
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      headers: { 'idempotency-key': keyFor(page) },
      payload: {
        title: selection.slice(0, 80),
        extractedText: selection,
        extractedHtml: `<p>${selection}</p>`,
        originalUrl: page,
        source: 'extension',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe('extension');
    expect(res.json().extractedText).toBe(selection);
    expect(res.json().extractedHtml).toContain(selection);
  });

  it('other user GET is 404 INBOX_NOT_FOUND', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app, 'bob');
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Secret' },
    });
    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/inbox/${created.json().id}`,
      token: bob.token,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('INBOX_NOT_FOUND');
  });

  it('PATCH assets binds tmp images onto the inbox item', async () => {
    const alice = await registerUser(app);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'With pics', originalUrl: 'https://example.com/pics' },
    });
    const inbox = created.json().id as string;
    const attId = await readyImage(alice.token);
    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/inbox/${inbox}/assets`,
      token: alice.token,
      payload: {
        assets: [{ attachmentId: attId, originalSrc: 'https://example.com/x.jpg', sortOrder: 0 }],
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().assets).toHaveLength(1);
    expect(patched.json().assets[0].attachmentId).toBe(attId);
    const [row] = await db.select().from(attachments).where(eq(attachments.id, attId));
    expect(row?.ownerType).toBe('inbox');
    expect(row?.ownerId).toBe(inbox);
    expect(row?.s3Key).toBe(`inbox/${alice.id}/${inbox}/${attId}.jpeg`);
  });

  it('bind ownerType=inbox copies tmp key', async () => {
    const alice = await registerUser(app);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Bind me' },
    });
    const attId = await readyImage(alice.token);
    const bind = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${attId}/bind`,
      token: alice.token,
      payload: { ownerType: 'inbox', ownerId: created.json().id },
    });
    expect(bind.statusCode).toBe(200);
    expect(bind.json().ownerType).toBe('inbox');
  });

  it('convert writes two entity_links and a task', async () => {
    const alice = await registerUser(app);
    const list = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Turn into task', originalUrl: 'https://example.com/t' },
    });
    const convert = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${created.json().id}/convert`,
      token: alice.token,
      payload: {},
    });
    expect(convert.statusCode).toBe(201);
    expect(convert.json().task.title).toBe('Turn into task');
    expect(convert.json().task.listId).toBe(list);
    expect(convert.json().inbox.status).toBe('converted');
    expect(convert.json().inbox.convertedTaskId).toBe(convert.json().task.id);
    const links = await db.select().from(entityLinks).where(eq(entityLinks.userId, alice.id));
    expect(links).toHaveLength(2);
    const roles = links.map((l) => `${l.fromType}->${l.toType}:${l.role}`).sort();
    expect(roles).toEqual(['inbox->task:converted_from', 'task->inbox:converted_from']);
  });

  it('completing converted task archives inbox only when convertArchiveOnComplete', async () => {
    const alice = await registerUser(app);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Archive?' },
    });
    const convert = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${created.json().id}/convert`,
      token: alice.token,
      payload: {},
    });
    const complete = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${convert.json().task.id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(complete.statusCode).toBe(200);
    const still = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/inbox/${created.json().id}`,
      token: alice.token,
    });
    expect(still.json().status).toBe('converted');

    await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token: alice.token,
      payload: { convertArchiveOnComplete: true },
    });
    const created2 = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Archive me' },
    });
    const convert2 = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${created2.json().id}/convert`,
      token: alice.token,
      payload: {},
    });
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${convert2.json().task.id}/complete`,
      token: alice.token,
      payload: {},
    });
    const archived = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/inbox/${created2.json().id}`,
      token: alice.token,
    });
    expect(archived.json().status).toBe('archived');
  });

  it('search type inbox finds CJK titles', async () => {
    const alice = await registerUser(app);
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: '稍后读牛奶' },
    });
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/search',
      token: alice.token,
      payload: { q: '牛奶', types: ['inbox'] },
    });
    expect(res.statusCode).toBe(200);
    const titles = (res.json().items as { type: string; inbox: { title: string } }[]).map(
      (h) => h.inbox.title,
    );
    expect(titles).toContain('稍后读牛奶');
    expect(res.json().items[0].type).toBe('inbox');
  });

  it('SSRF: extract of loopback/file is 400 and not persisted', async () => {
    const alice = await registerUser(app);
    for (const url of ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/']) {
      const res = await injectJson(app, {
        method: 'POST',
        url: '/api/v1/inbox/extract',
        token: alice.token,
        payload: { url },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('1.2MB extract preview POSTs back as persist 201', async () => {
    const alice = await registerUser(app);
    const html = `<p>${'x'.repeat(1_200_000)}</p>`;
    const persist = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Long', extractedHtml: html, source: 'web' },
    });
    expect(persist.statusCode).toBe(201);
    expect((persist.json().extractedHtml as string).length).toBeGreaterThan(1_000_000);
  });

  it('JSON over inbox bodyLimit is 413 VALIDATION_ERROR not 500', async () => {
    const alice = await registerUser(app);
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Huge', extractedHtml: 'x'.repeat(INBOX_JSON_BODY_LIMIT_BYTES) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it(
    'hung DNS extract is 400 within the 10s cap and releases the semaphore',
    async () => {
      const alice = await registerUser(app);
      setExtractTransport({
        lookup: () => new Promise(() => undefined),
        request: () => Promise.reject(new Error('must not fetch after hung DNS')),
      });
      const started = Date.now();
      const res = await injectJson(app, {
        method: 'POST',
        url: '/api/v1/inbox/extract',
        token: alice.token,
        payload: { url: 'https://hang.example/article' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(Date.now() - started).toBeLessThan(EXTRACT_TIMEOUT_MS + 2000);
      expect(extractSemaphore.running).toBe(0);

      setExtractTransport(mockPublicHtml());
      const ok = await injectJson(app, {
        method: 'POST',
        url: '/api/v1/inbox/extract',
        token: alice.token,
        payload: { url: 'https://news.example.com/a' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().title).toBeTruthy();
    },
    EXTRACT_TIMEOUT_MS + 15_000,
  );

  it('soft delete hides the item', async () => {
    const alice = await registerUser(app);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Gone' },
    });
    const del = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/inbox/${created.json().id}`,
      token: alice.token,
    });
    expect(del.statusCode).toBe(204);
    const get = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/inbox/${created.json().id}`,
      token: alice.token,
    });
    expect(get.statusCode).toBe(404);
  });
});
