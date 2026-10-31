import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { attachments, type Attachment } from '../db/schema/attachments.js';
import { AppError } from '../errors.js';
import { getStorage } from '../storage/factory.js';

export async function getOwnedAttachmentOr404(userId: string, id: string): Promise<Attachment> {
  const [row] = await getDb().select().from(attachments).where(eq(attachments.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'ATTACHMENT_NOT_FOUND');
  return row;
}

/** A profile avatar must already be a ready attachment bound to this user. */
export async function assertAvatarAttachment(userId: string, id: string): Promise<void> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status !== 'ready' || row.ownerType !== 'user' || row.ownerId !== userId) {
    throw AppError.of(404, 'ATTACHMENT_NOT_FOUND');
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
