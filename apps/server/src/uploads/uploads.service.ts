import { randomUUID } from 'node:crypto';
import mime from 'mime-types';
import {
  MAX_IMAGE_BYTES,
  type UploadBindInput,
  type UploadBindResponse,
  type UploadCompleteResponse,
  type UploadPresignInput,
  type UploadPresignResponse,
} from '@vital/dto';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { attachments, inboxItems, type Attachment } from '../db/schema.js';
import { getOwnedReportOr404 } from '../reports/reports.service.js';
import { AppError } from '../errors.js';
import { currentStorageMeta, getStorage } from '../storage/factory.js';
import { getOwnedTaskOr404 } from '../tasks/tasks.service.js';
import { logger } from '../utils/logger.js';

async function getOwnedAttachmentOr404(userId: string, id: string): Promise<Attachment> {
  const [row] = await getDb().select().from(attachments).where(eq(attachments.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'ATTACHMENT_NOT_FOUND');
  return row;
}

export async function presignUpload(
  userId: string,
  input: UploadPresignInput,
): Promise<UploadPresignResponse> {
  if (input.size > MAX_IMAGE_BYTES) {
    throw AppError.of(413, 'MEDIA_TOO_LARGE');
  }

  const id = randomUUID();
  const ext = mime.extension(input.mime) || 'bin';
  const tmpKey = `tmp/${id}.${ext}`;

  await getDb().insert(attachments).values({
    id,
    userId,
    ownerType: 'tmp',
    ownerId: null,
    s3Key: tmpKey,
    mime: input.mime,
    size: input.size,
    status: 'uploading',
    storageMeta: currentStorageMeta(),
    uploadId: null,
    sortOrder: 0,
  });

  const url = await getStorage().presignPut(
    tmpKey,
    { contentType: input.mime },
    config.PRESIGN_PUT_TTL_SECONDS,
  );
  return { id, method: 'put', url, expiresIn: config.PRESIGN_PUT_TTL_SECONDS };
}

export async function completeUpload(userId: string, id: string): Promise<UploadCompleteResponse> {
  const started = Date.now();
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status === 'ready') {
    return { id: row.id, status: 'ready', mime: row.mime, size: row.size, ownerType: 'tmp' };
  }
  if (row.status !== 'uploading') {
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }

  const head = await getStorage().headObject(row.s3Key);
  if (!head || head.size !== row.size || head.contentType !== row.mime) {
    throw AppError.of(422, 'MEDIA_MISMATCH');
  }

  const updated = await getDb()
    .update(attachments)
    .set({ status: 'ready' })
    .where(and(eq(attachments.id, id), eq(attachments.status, 'uploading')))
    .returning({ id: attachments.id });
  if (updated.length === 0) {
    const [now] = await getDb().select().from(attachments).where(eq(attachments.id, id)).limit(1);
    if (now?.status === 'ready') {
      return { id: row.id, status: 'ready', mime: row.mime, size: row.size, ownerType: 'tmp' };
    }
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }
  logger.info('upload_complete_ms', { id, ms: Date.now() - started });
  return { id: row.id, status: 'ready', mime: row.mime, size: row.size, ownerType: 'tmp' };
}

export async function abortUpload(userId: string, id: string): Promise<void> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status === 'orphaned') return;
  if (row.status !== 'uploading') throw AppError.of(409, 'MEDIA_INVALID_STATE');
  const updated = await getDb()
    .update(attachments)
    .set({ status: 'orphaned', orphanedAt: new Date() })
    .where(and(eq(attachments.id, id), eq(attachments.status, 'uploading')))
    .returning({ id: attachments.id });
  if (updated.length === 0) return;
  if (row.uploadId) {
    await getStorage().abortMultipart(row.s3Key, row.uploadId);
  }
}

export async function discardUpload(userId: string, id: string): Promise<void> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status === 'orphaned') return;
  if (row.ownerType !== 'tmp') throw AppError.of(409, 'MEDIA_INVALID_STATE');
  await getDb()
    .update(attachments)
    .set({ status: 'orphaned', orphanedAt: new Date() })
    .where(eq(attachments.id, id));
  if (row.uploadId) {
    await getStorage()
      .abortMultipart(row.s3Key, row.uploadId)
      .catch((err: unknown) => {
        logger.warn('discard abort multipart failed', { id, err: String(err) });
      });
  }
}

export async function resolveAccessUrl(userId: string, id: string): Promise<string> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status !== 'ready') throw AppError.of(404, 'ATTACHMENT_NOT_FOUND');
  return getStorage().generateAccessUrl(row.s3Key, row.storageMeta, config.PRESIGN_GET_TTL_SECONDS);
}

export async function bindUpload(
  userId: string,
  id: string,
  input: UploadBindInput,
): Promise<UploadBindResponse> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status !== 'ready' || row.ownerType !== 'tmp') {
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }
  if (input.ownerType === 'task') {
    await getOwnedTaskOr404(userId, input.ownerId);
  } else if (input.ownerType === 'inbox') {
    const [owner] = await getDb()
      .select({ id: inboxItems.id, userId: inboxItems.userId, deletedAt: inboxItems.deletedAt })
      .from(inboxItems)
      .where(eq(inboxItems.id, input.ownerId))
      .limit(1);
    if (!owner || owner.userId !== userId || owner.deletedAt) {
      throw AppError.of(404, 'INBOX_NOT_FOUND');
    }
  } else {
    await getOwnedReportOr404(userId, input.ownerId);
  }

  const ext = mime.extension(row.mime) || 'bin';
  const destKey = `${input.ownerType}/${userId}/${input.ownerId}/${id}.${ext}`;
  const storage = getStorage();
  await storage.copyObject(row.s3Key, destKey, row.storageMeta);
  await storage.deleteFile(row.s3Key, row.storageMeta);
  await getDb()
    .update(attachments)
    .set({ s3Key: destKey, ownerType: input.ownerType, ownerId: input.ownerId })
    .where(eq(attachments.id, id));
  return { id, status: 'ready', ownerType: input.ownerType, ownerId: input.ownerId };
}
