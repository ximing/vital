import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { db } from '../src/db/index.js';
import { attachments } from '../src/db/schema.js';
import { setStorageAdapter } from '../src/storage/factory.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { installMockStorage, type MockStorage } from './helpers/storage.js';

let app: FastifyInstance;
let storage: MockStorage;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
});

afterEach(() => {
  setStorageAdapter(null);
});

afterAll(async () => {
  await app.close();
});

async function register(name: string): Promise<{ id: string; token: string }> {
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: `${name}-${Date.now()}@test.com`,
      password: 'secret123',
      displayName: name,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`register failed ${res.statusCode} ${res.body}`);
  }
  const body = res.json();
  return { id: body.user.id, token: body.tokens.accessToken };
}

const PART = 5 * 1024 * 1024;
const SIZE_3P = 12 * 1024 * 1024; // 3 parts at 5MB

async function initUploadFor(alice: { token: string }, payload: Record<string, unknown> = {}) {
  return injectJson(app, {
    method: 'POST',
    url: '/api/v1/uploads',
    token: alice.token,
    payload: { mime: 'video/mp4', size: SIZE_3P, ...payload },
  });
}

describe('uploads (multipart)', () => {
  it('unauthenticated init is 401', async () => {
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/uploads',
      payload: { mime: 'video/mp4', size: 1024 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('init creates uploading row with uploadId and part math', async () => {
    const alice = await register('alice');
    const res = await initUploadFor(alice);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.uploadId).toBe('fake-upload-id');
    expect(body.partSize).toBe(PART);
    expect(body.totalParts).toBe(3);
    expect(body.parts).toEqual([]);
    const [row] = await db.select().from(attachments).where(eq(attachments.id, body.id));
    expect(row).toMatchObject({
      userId: alice.id,
      mime: 'video/mp4',
      status: 'uploading',
      uploadId: 'fake-upload-id',
    });
    expect(storage.initMultipart).toHaveBeenCalledWith(row?.s3Key, { contentType: 'video/mp4' });
  });

  it('init rejects non-whitelisted mime (422) and over-5GB (413) at service level', async () => {
    const alice = await register('alice');
    const badMime = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/uploads',
      token: alice.token,
      payload: { mime: 'image/svg+xml', size: 100 },
    });
    expect(badMime.statusCode).toBe(422);
    expect(badMime.json().error.code).toBe('MEDIA_MISMATCH');
    const tooBig = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/uploads',
      token: alice.token,
      payload: { mime: 'video/mp4', size: 5 * 1024 ** 3 + 1 },
    });
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.json().error.code).toBe('MEDIA_TOO_LARGE');
    expect(await db.select().from(attachments)).toHaveLength(0);
  });

  it('resumeId returns the same session with uploaded parts incl etags', async () => {
    const alice = await register('alice');
    const first = await initUploadFor(alice);
    const id = first.json().id;
    storage.listParts.mockResolvedValueOnce([{ partNumber: 1, size: PART, etag: '"e1"' }]);

    const resumed = await initUploadFor(alice, { resumeId: id });
    expect(resumed.statusCode).toBe(201);
    const body = resumed.json();
    expect(body.id).toBe(id);
    expect(body.parts).toEqual([{ partNumber: 1, size: PART, etag: '"e1"' }]);
    expect(storage.initMultipart).toHaveBeenCalledTimes(1);
  });

  it('resumeId with mismatched size is 409 MEDIA_INVALID_STATE', async () => {
    const alice = await register('alice');
    const first = await initUploadFor(alice);
    const res = await initUploadFor(alice, { size: 20 * 1024 * 1024, resumeId: first.json().id });
    expect(res.statusCode).toBe(409);
  });

  it('presign part validates range and ownership', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const { id } = (await initUploadFor(alice)).json();

    const ok = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/parts/2`,
      token: alice.token,
      payload: {},
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().url).toBe('https://fake.local/presigned-part');
    expect(storage.presignPart).toHaveBeenCalledWith(
      expect.any(String),
      'fake-upload-id',
      2,
      expect.any(Number),
    );

    const outOfRange = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/parts/99`,
      token: alice.token,
      payload: {},
    });
    expect(outOfRange.statusCode).toBe(422);
    expect(outOfRange.json().error.code).toBe('MEDIA_PART_INVALID');

    const foreign = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/parts/1`,
      token: bob.token,
      payload: {},
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('GET /uploads/:id/parts lists uploaded parts for the owner', async () => {
    const alice = await register('alice');
    const { id } = (await initUploadFor(alice)).json();
    storage.listParts.mockResolvedValueOnce([
      { partNumber: 1, size: PART, etag: '"e1"' },
      { partNumber: 2, size: PART, etag: '"e2"' },
    ]);
    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/uploads/${id}/parts`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().parts).toHaveLength(2);
  });

  it('complete with missing parts is 422 MEDIA_PART_MISSING; full set marks ready', async () => {
    const alice = await register('alice');
    const init = await initUploadFor(alice);
    const { id, totalParts } = init.json();

    const missing = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/complete`,
      token: alice.token,
      payload: { parts: [{ partNumber: 1, etag: '"e1"' }] },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.code).toBe('MEDIA_PART_MISSING');

    storage.headObject.mockResolvedValueOnce({
      size: SIZE_3P,
      contentType: 'video/mp4',
      lastModified: new Date(),
    });
    const full = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/complete`,
      token: alice.token,
      payload: {
        parts: Array.from({ length: totalParts }, (_, i) => ({ partNumber: i + 1, etag: `"e${i + 1}"` })),
      },
    });
    expect(full.statusCode).toBe(200);
    expect(full.json()).toMatchObject({ id, status: 'ready', mime: 'video/mp4' });
    expect(storage.completeMultipart).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(row?.status).toBe('ready');
  });

  it('HEAD mismatch on complete is 422 MEDIA_MISMATCH', async () => {
    const alice = await register('alice');
    const { id, totalParts } = (await initUploadFor(alice)).json();
    storage.headObject.mockResolvedValueOnce({ size: 999, contentType: 'video/mp4', lastModified: new Date() });
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/complete`,
      token: alice.token,
      payload: {
        parts: Array.from({ length: totalParts }, (_, i) => ({ partNumber: i + 1, etag: `"e${i + 1}"` })),
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MEDIA_MISMATCH');
  });

  it('abort calls abortMultipart and orphans the row', async () => {
    const alice = await register('alice');
    const { id } = (await initUploadFor(alice)).json();
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/abort`,
      token: alice.token,
      payload: {},
    });
    expect(res.statusCode).toBe(204);
    expect(storage.abortMultipart).toHaveBeenCalledWith(expect.any(String), 'fake-upload-id');
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(row?.status).toBe('orphaned');
  });

  it('old presign and 302 GET routes are gone', async () => {
    const alice = await register('alice');
    const presign = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/uploads/presign',
      token: alice.token,
      payload: { mime: 'image/jpeg', size: 10 },
    });
    expect(presign.statusCode).toBe(404);
    const redirect = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/uploads/00000000-0000-4000-8000-000000000000',
      token: alice.token,
    });
    expect(redirect.statusCode).toBe(404);
  });
});
