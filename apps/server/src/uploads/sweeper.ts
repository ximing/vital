import { and, asc, eq, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { attachments, type Attachment } from '../db/schema.js';
import { getStorage } from '../storage/factory.js';
import { logger } from '../utils/logger.js';

export interface SweepResult {
  scanned: number;
  markedOrphaned: number;
  deletedObjects: number;
  dryRun: boolean;
}

const BATCH_LIMIT = 500;

const MS_PER_DAY = 86_400_000;

export async function sweepStaleUploadingAttachments(
  now = new Date(),
  opts?: { dryRun?: boolean },
): Promise<SweepResult> {
  const dryRun = opts?.dryRun ?? config.SWEEPER_DRY_RUN;
  const result: SweepResult = { scanned: 0, markedOrphaned: 0, deletedObjects: 0, dryRun };
  const cutoff = new Date(now.getTime() - config.MEDIA_UPLOADING_TTL_HOURS * 3_600_000);
  const rows = await getDb()
    .select()
    .from(attachments)
    .where(and(eq(attachments.status, 'uploading'), lt(attachments.createdAt, cutoff)))
    .orderBy(asc(attachments.createdAt))
    .limit(BATCH_LIMIT);
  result.scanned = rows.length;
  for (const row of rows) {
    if (dryRun) {
      logger.info('sweeper dry-run: would orphan stale uploading attachment', {
        id: row.id,
        key: row.s3Key,
        createdAt: row.createdAt,
      });
      continue;
    }
    if (!(await destroyObject(row))) continue;
    result.deletedObjects += 1;
    await getDb()
      .update(attachments)
      .set({ status: 'orphaned', orphanedAt: now })
      .where(eq(attachments.id, row.id));
    result.markedOrphaned += 1;
  }
  logger.info('sweeper stale uploading attachments done', { ...result });
  return result;
}

/**
 * Ready tmp rows the user never bound. Attachments have no updated_at — TTL
 * is measured from created_at (init), which is typically minutes before complete.
 * S3 tmp/ lifecycle expires objects at 7d; this runs slightly earlier (default 6d).
 */
export async function sweepOrphanReadyTmpAttachments(
  now = new Date(),
  opts?: { dryRun?: boolean },
): Promise<SweepResult> {
  const dryRun = opts?.dryRun ?? config.SWEEPER_DRY_RUN;
  const result: SweepResult = { scanned: 0, markedOrphaned: 0, deletedObjects: 0, dryRun };
  const cutoff = new Date(now.getTime() - config.MEDIA_TMP_READY_TTL_DAYS * MS_PER_DAY);
  const rows = await getDb()
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.status, 'ready'),
        eq(attachments.ownerType, 'tmp'),
        lt(attachments.createdAt, cutoff),
      ),
    )
    .orderBy(asc(attachments.createdAt))
    .limit(BATCH_LIMIT);
  result.scanned = rows.length;
  for (const row of rows) {
    if (dryRun) {
      logger.info('sweeper dry-run: would orphan ready tmp attachment', {
        id: row.id,
        key: row.s3Key,
        createdAt: row.createdAt,
      });
      continue;
    }
    if (await bestEffortDeleteObject(row)) result.deletedObjects += 1;
    await getDb()
      .update(attachments)
      .set({ status: 'orphaned', orphanedAt: now })
      .where(eq(attachments.id, row.id));
    result.markedOrphaned += 1;
  }
  logger.info('sweeper ready tmp attachments done', { ...result });
  return result;
}

async function destroyObject(row: Attachment): Promise<boolean> {
  const storage = getStorage();
  if (row.uploadId) {
    try {
      await storage.abortMultipart(row.s3Key, row.uploadId);
    } catch (err) {
      logger.warn('sweeper abort multipart failed', { id: row.id, err: String(err) });
    }
  }
  try {
    await storage.deleteFile(row.s3Key, row.storageMeta);
    return true;
  } catch (err) {
    logger.warn('sweeper delete object failed（保留行，下轮重试）', {
      id: row.id,
      key: row.s3Key,
      err: String(err),
    });
    return false;
  }
}

/** Lifecycle will expire tmp/ objects; a failed delete still orphans the row. */
async function bestEffortDeleteObject(row: Attachment): Promise<boolean> {
  try {
    await getStorage().deleteFile(row.s3Key, row.storageMeta);
    return true;
  } catch (err) {
    logger.warn('sweeper delete ready-tmp object failed (lifecycle will expire it)', {
      id: row.id,
      key: row.s3Key,
      err: String(err),
    });
    return false;
  }
}

export function startSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void (async () => {
      await sweepStaleUploadingAttachments();
      await sweepOrphanReadyTmpAttachments();
    })().catch((err: unknown) => {
      logger.error('sweeper crashed', err);
    });
  }, config.SWEEPER_INTERVAL_MS);
  timer.unref();
  logger.info('sweeper started', { intervalMs: config.SWEEPER_INTERVAL_MS });
  return timer;
}
