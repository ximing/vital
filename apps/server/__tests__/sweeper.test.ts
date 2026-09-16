import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { attachments, users } from '../src/db/schema.js';
import { setStorageAdapter } from '../src/storage/factory.js';
import {
  sweepOrphanReadyTmpAttachments,
  sweepStaleUploadingAttachments,
} from '../src/uploads/sweeper.js';
import { resetDb } from './helpers/db.js';
import { installMockStorage, type MockStorage } from './helpers/storage.js';

describe('sweeper', () => {
  let storage: MockStorage;

  beforeEach(async () => {
    await resetDb();
    storage = installMockStorage();
  });

  afterEach(() => {
    setStorageAdapter(null);
  });

  it('marks uploading > 24h as orphaned and deletes the object', async () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    const id = '11111111-1111-4111-8111-111111111111';
    await db.insert(users).values({
      id: userId,
      email: 'sweep@test.com',
      passwordHash: 'not-a-real-hash',
      displayName: 'Sweep',
    });
    await db.insert(attachments).values({
      id,
      userId,
      ownerType: 'tmp',
      s3Key: `tmp/${id}.jpeg`,
      mime: 'image/jpeg',
      size: 10,
      status: 'uploading',
      storageMeta: {
        bucket: 'vital',
        prefix: 'test/attachments',
        region: 'cn-beijing',
        isPublicBucket: 'false',
      },
    });
    await db
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(attachments.id, id));

    const result = await sweepStaleUploadingAttachments(new Date(), { dryRun: false });
    expect(result.scanned).toBe(1);
    expect(result.markedOrphaned).toBe(1);
    expect(result.deletedObjects).toBe(1);
    expect(storage.deleteFile).toHaveBeenCalled();

    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(row?.status).toBe('orphaned');
  });

  it('stale uploading with uploadId aborts the multipart session', async () => {
    const userId = '44444444-4444-4444-8444-444444444444';
    const id = '33333333-3333-4333-8333-333333333333';
    await db.insert(users).values({
      id: userId,
      email: 'sweep-multipart@test.com',
      passwordHash: 'not-a-real-hash',
      displayName: 'Sweep Multipart',
    });
    await db.insert(attachments).values({
      id,
      userId,
      ownerType: 'tmp',
      s3Key: `tmp/${id}.mp4`,
      mime: 'video/mp4',
      size: 10,
      status: 'uploading',
      uploadId: 'fake-upload-id',
      storageMeta: {
        bucket: 'vital',
        prefix: 'test/attachments',
        region: 'cn-beijing',
        isPublicBucket: 'false',
      },
    });
    await db
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(attachments.id, id));

    const result = await sweepStaleUploadingAttachments(new Date(), { dryRun: false });
    expect(result.scanned).toBe(1);
    expect(result.markedOrphaned).toBe(1);
    expect(result.deletedObjects).toBe(1);
    expect(storage.abortMultipart).toHaveBeenCalledWith(`tmp/${id}.mp4`, 'fake-upload-id');
    expect(storage.deleteFile).toHaveBeenCalled();

    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(row?.status).toBe('orphaned');
  });

  it('marks ready tmp older than TTL as orphaned and best-effort deletes', async () => {
    const userId = '55555555-5555-4555-8555-555555555555';
    const staleId = '66666666-6666-4666-8666-666666666666';
    const freshId = '77777777-7777-4777-8777-777777777777';
    const boundId = '88888888-8888-4888-8888-888888888888';
    await db.insert(users).values({
      id: userId,
      email: 'sweep-ready@test.com',
      passwordHash: 'not-a-real-hash',
      displayName: 'Sweep Ready',
    });
    const meta = {
      bucket: 'vital',
      prefix: 'test/attachments',
      region: 'cn-beijing',
      isPublicBucket: 'false' as const,
    };
    await db.insert(attachments).values([
      {
        id: staleId,
        userId,
        ownerType: 'tmp',
        s3Key: `tmp/${staleId}.jpeg`,
        mime: 'image/jpeg',
        size: 10,
        status: 'ready',
        storageMeta: meta,
      },
      {
        id: freshId,
        userId,
        ownerType: 'tmp',
        s3Key: `tmp/${freshId}.jpeg`,
        mime: 'image/jpeg',
        size: 10,
        status: 'ready',
        storageMeta: meta,
      },
      {
        id: boundId,
        userId,
        ownerType: 'list',
        ownerId: userId,
        s3Key: `list/${userId}/${userId}/${boundId}.jpeg`,
        mime: 'image/jpeg',
        size: 10,
        status: 'ready',
        storageMeta: meta,
      },
    ]);
    await db
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 7 * 86_400_000) })
      .where(eq(attachments.id, staleId));

    const result = await sweepOrphanReadyTmpAttachments(new Date(), { dryRun: false });
    expect(result.scanned).toBe(1);
    expect(result.markedOrphaned).toBe(1);
    expect(result.deletedObjects).toBe(1);
    expect(storage.deleteFile).toHaveBeenCalledWith(`tmp/${staleId}.jpeg`, expect.anything());

    const [stale] = await db.select().from(attachments).where(eq(attachments.id, staleId));
    const [fresh] = await db.select().from(attachments).where(eq(attachments.id, freshId));
    const [bound] = await db.select().from(attachments).where(eq(attachments.id, boundId));
    expect(stale?.status).toBe('orphaned');
    expect(fresh?.status).toBe('ready');
    expect(bound?.status).toBe('ready');
  });

  it('orphans ready tmp even when deleteFile fails', async () => {
    const userId = '99999999-9999-4999-8999-999999999999';
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await db.insert(users).values({
      id: userId,
      email: 'sweep-ready-del@test.com',
      passwordHash: 'not-a-real-hash',
      displayName: 'Sweep Ready Del',
    });
    await db.insert(attachments).values({
      id,
      userId,
      ownerType: 'tmp',
      s3Key: `tmp/${id}.png`,
      mime: 'image/png',
      size: 10,
      status: 'ready',
      storageMeta: {
        bucket: 'vital',
        prefix: 'test/attachments',
        region: 'cn-beijing',
        isPublicBucket: 'false',
      },
    });
    await db
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 7 * 86_400_000) })
      .where(eq(attachments.id, id));
    storage.deleteFile.mockRejectedValueOnce(new Error('s3 down'));

    const result = await sweepOrphanReadyTmpAttachments(new Date(), { dryRun: false });
    expect(result.scanned).toBe(1);
    expect(result.markedOrphaned).toBe(1);
    expect(result.deletedObjects).toBe(0);

    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(row?.status).toBe('orphaned');
  });
});
