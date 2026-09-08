import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { attachments, inboxAssets, inboxItems, users } from '../../src/db/schema.js';
import { loadAssetsByItemIds } from '../../src/inbox/inbox.service.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});
beforeEach(async () => {
  await resetDb();
  installMockStorage();
});
afterEach(() => {
  setStorageAdapter(null);
});
afterAll(async () => {
  await app.close();
});

describe('inbox asset mime', () => {
  it('loadAssetsByItemIds returns attachment mime', async () => {
    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      email: `asset-mime-${Date.now()}@test.com`,
      passwordHash: 'x',
      displayName: 't',
    });
    const attachmentId = '22222222-2222-4222-8222-222222222222';
    const itemId = '33333333-3333-4333-8333-333333333333';
    await db.insert(attachments).values({
      id: attachmentId,
      userId,
      ownerType: 'tmp',
      s3Key: 'tmp/x.pdf',
      mime: 'application/pdf',
      size: 100,
      status: 'ready',
      storageMeta: {},
    });
    await db.insert(inboxItems).values({
      id: itemId,
      userId,
      title: 'pdf item',
      status: 'unread',
      source: 'extension',
    });
    await db.insert(inboxAssets).values({
      id: randomUUID(),
      inboxItemId: itemId,
      attachmentId,
      originalSrc: 'https://ex.com/a.pdf',
      sortOrder: 0,
    });

    const map = await loadAssetsByItemIds([itemId]);
    expect(map.get(itemId)).toHaveLength(1);
    expect(map.get(itemId)?.[0]).toMatchObject({ mime: 'application/pdf', attachmentId });
  });
});
