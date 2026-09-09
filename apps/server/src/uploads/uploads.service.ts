import { randomUUID } from 'node:crypto';
import mime from 'mime-types';
import {
  MAX_UPLOAD_BYTES,
  isUploadableMime,
  partSizeFor,
  totalPartsFor,
  type PartPresignResponse,
  type UploadBindInput,
  type UploadBindResponse,
  type UploadCompletePartsInput,
  type UploadCompleteResponse,
  type UploadInitInput,
  type UploadInitResponse,
  type UploadPartsResponse,
  type UploadUrlResponse,
} from '@vital/dto';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { attachments, inboxItems, lists, type Attachment } from '../db/schema.js';
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

export async function initUpload(userId: string, input: UploadInitInput): Promise<UploadInitResponse> {
  if (!isUploadableMime(input.mime)) {
    throw AppError.of(422, 'MEDIA_MISMATCH');
  }
  if (input.size > MAX_UPLOAD_BYTES) {
    throw AppError.of(413, 'MEDIA_TOO_LARGE');
  }
  const partSize = partSizeFor(input.size);
  const totalParts = totalPartsFor(input.size);

  if (input.resumeId !== undefined) {
    const [row] = await getDb()
      .select()
      .from(attachments)
      .where(eq(attachments.id, input.resumeId))
      .limit(1);
    if (
      row &&
      row.userId === userId &&
      row.status === 'uploading' &&
      row.uploadId !== null &&
      row.mime === input.mime &&
      row.size === input.size
    ) {
      const parts = await getStorage().listParts(row.s3Key, row.uploadId);
      return { id: row.id, uploadId: row.uploadId, partSize, totalParts, parts };
    }
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }

  const id = randomUUID();
  const ext = mime.extension(input.mime) || 'bin';
  const tmpKey = `tmp/${id}.${ext}`;
  const uploadId = await getStorage().initMultipart(tmpKey, { contentType: input.mime });
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
    uploadId,
    sortOrder: 0,
  });
  return { id, uploadId, partSize, totalParts, parts: [] };
}

export async function listUploadedParts(userId: string, id: string): Promise<UploadPartsResponse> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status !== 'uploading' || row.uploadId === null) {
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }
  return { parts: await getStorage().listParts(row.s3Key, row.uploadId) };
}

export async function presignPartUpload(
  userId: string,
  id: string,
  partNumber: number,
): Promise<PartPresignResponse> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status !== 'uploading' || row.uploadId === null) {
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalPartsFor(row.size)) {
    throw AppError.of(422, 'MEDIA_PART_INVALID');
  }
  const url = await getStorage().presignPart(
    row.s3Key,
    row.uploadId,
    partNumber,
    config.PRESIGN_PUT_TTL_SECONDS,
  );
  return { url, expiresIn: config.PRESIGN_PUT_TTL_SECONDS };
}

export async function completeMultipartUpload(
  userId: string,
  id: string,
  input: UploadCompletePartsInput,
): Promise<UploadCompleteResponse> {
  const started = Date.now();
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status === 'ready') {
    return { id: row.id, status: 'ready', mime: row.mime, size: row.size, ownerType: 'tmp' };
  }
  if (row.status !== 'uploading' || row.uploadId === null) {
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }
  const totalParts = totalPartsFor(row.size);
  // Harden the assembly list before it reaches S3: every part number must be
  // in range and unique (a duplicate would silently pick the last etag).
  const seen = new Set(input.parts.map((p) => p.partNumber));
  if (seen.size !== input.parts.length || input.parts.some((p) => p.partNumber > totalParts)) {
    throw AppError.of(422, 'MEDIA_PART_INVALID');
  }
  for (let n = 1; n <= totalParts; n += 1) {
    if (!seen.has(n)) throw AppError.of(422, 'MEDIA_PART_MISSING');
  }
  await getStorage().completeMultipart(
    row.s3Key,
    row.uploadId,
    input.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
  );
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

export async function resolveAccessUrl(userId: string, id: string, expiresIn?: number): Promise<string> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status !== 'ready') throw AppError.of(404, 'ATTACHMENT_NOT_FOUND');
  return getStorage().generateAccessUrl(
    row.s3Key,
    row.storageMeta,
    expiresIn ?? config.PRESIGN_GET_TTL_SECONDS,
  );
}

/** Signed GET url for a ready attachment — the 302 replacement clients render from. */
export async function getUploadUrl(userId: string, id: string): Promise<UploadUrlResponse> {
  const url = await resolveAccessUrl(userId, id);
  return { url, expiresIn: config.PRESIGN_GET_TTL_SECONDS };
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
  } else if (input.ownerType === 'report') {
    await getOwnedReportOr404(userId, input.ownerId);
  } else if (input.ownerType === 'list') {
    const [owner] = await getDb()
      .select({ id: lists.id, userId: lists.userId, kind: lists.kind })
      .from(lists)
      .where(eq(lists.id, input.ownerId))
      .limit(1);
    if (!owner || owner.userId !== userId || owner.kind !== 'user') {
      throw AppError.of(404, 'LIST_NOT_FOUND');
    }
  } else if (input.ownerId !== userId) {
    throw AppError.of(404, 'NOT_FOUND');
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
