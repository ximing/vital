import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '@vital/dto';
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

describe('uploads', () => {
  it('unauthenticated presign is 401', async () => {
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/uploads/presign',
      payload: { mime: 'image/jpeg', size: 1024 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('presign inserts uploading tmp row and returns PUT url', async () => {
    const alice = await register('alice');
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/uploads/presign',
      token: alice.token,
      payload: { mime: 'image/jpeg', size: 1024 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.method).toBe('put');
    expect(body.url).toBe('https://fake.local/presigned-put');

    const [row] = await db.select().from(attachments).where(eq(attachments.id, body.id));
    expect(row).toMatchObject({
      userId: alice.id,
      mime: 'image/jpeg',
      size: 1024,
      status: 'uploading',
      ownerType: 'tmp',
    });
    expect(row?.s3Key).toBe(`tmp/${body.id}.jpeg`);
    expect(storage.presignPut).toHaveBeenCalledWith(row?.s3Key, { contentType: 'image/jpeg' }, 900);
  });

  it('presign over 10MB is 413 and does not insert', async () => {
    const alice = await register('alice');
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/uploads/presign',
      token: alice.token,
      payload: { mime: 'image/png', size: MAX_IMAGE_BYTES + 1 },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('MEDIA_TOO_LARGE');
    expect(await db.select().from(attachments)).toHaveLength(0);
  });

  it('complete HeadObject mismatch is 422 MEDIA_MISMATCH; match is ready tmp', async () => {
    const alice = await register('alice');
    const presigned = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/uploads/presign',
      token: alice.token,
      payload: { mime: 'image/jpeg', size: 1024 },
    });
    const id = presigned.json().id;

    storage.headObject.mockResolvedValue({
      size: 12,
      contentType: 'image/png',
      lastModified: new Date(),
    });
    const mismatch = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error.code).toBe('MEDIA_MISMATCH');

    storage.headObject.mockResolvedValue({
      size: 1024,
      contentType: 'image/jpeg',
      lastModified: new Date(),
    });
    const ok = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      id,
      status: 'ready',
      mime: 'image/jpeg',
      size: 1024,
      ownerType: 'tmp',
    });
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(row?.status).toBe('ready');
    expect(row?.ownerType).toBe('tmp');
  });

  it('GET ready attachment 302 with Cache-Control private max-age=300', async () => {
    const alice = await register('alice');
    const presigned = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/uploads/presign',
      token: alice.token,
      payload: { mime: 'image/jpeg', size: 1024 },
    });
    const id = presigned.json().id;
    storage.headObject.mockResolvedValue({
      size: 1024,
      contentType: 'image/jpeg',
      lastModified: new Date(),
    });
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/complete`,
      token: alice.token,
      payload: {},
    });

    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/uploads/${id}`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://fake.local/presigned-get');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
  });

  it('abort uploading is 204; other user is 404', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const presigned = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/uploads/presign',
      token: alice.token,
      payload: { mime: 'image/png', size: 2048 },
    });
    const id = presigned.json().id;

    const other = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/abort`,
      token: bob.token,
    });
    expect(other.statusCode).toBe(404);

    const abort = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/uploads/${id}/abort`,
      token: alice.token,
    });
    expect(abort.statusCode).toBe(204);
  });
});
