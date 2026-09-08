import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { attachments, users } from '../src/db/schema.js';
import { setStorageAdapter } from '../src/storage/factory.js';
import { sweepStaleUploadingAttachments } from '../src/uploads/sweeper.js';
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
});
