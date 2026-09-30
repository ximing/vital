import { randomUUID } from 'node:crypto';
import type {
  ExtractJob,
  ExtractJobList,
  ExtractJobListItem,
  ExtractJobStatus,
  InboxPreview,
  ListExtractJobsQuery,
} from '@vital/dto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { inboxExtractJobs } from '../db/schema.js';
import { isUniqueViolation } from '../db/pg.js';
import { toInboxPreview } from '../extract/extract.js';
import { loadRenderedArticle } from '../extract/rendered.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { idempotencyKeyForUrl } from './canonical.js';

const EXTRACT_JOB_BATCH = 2;
const autoKick = process.env.NODE_ENV !== 'test';

interface ClaimedJob {
  id: string;
  url: string;
}

function hasUsefulBody(article: {
  useful: boolean;
  doc: { content: unknown[] } | null;
  text: string | null;
}): boolean {
  if (!article.useful) return false;
  if (article.doc !== null && article.doc.content.length > 0) return true;
  return article.text !== null && article.text.trim() !== '';
}

function asStatus(status: string): ExtractJobStatus | null {
  if (status === 'queued' || status === 'running' || status === 'succeeded' || status === 'failed') {
    return status;
  }
  return null;
}

function viewOf(row: {
  id: string;
  status: string;
  preview: InboxPreview | null;
  errorCode: string | null;
}): ExtractJob {
  const status = asStatus(row.status);
  if (status === null) {
    return { id: row.id, status: 'failed', preview: null, errorCode: 'EXTRACT_FAILED' };
  }
  return {
    id: row.id,
    status,
    preview: status === 'succeeded' ? row.preview : null,
    errorCode: status === 'failed' ? row.errorCode : null,
  };
}

async function findReusable(userId: string, canonicalUrl: string): Promise<ExtractJob | null> {
  const rows = await getDb().execute(sql`
    SELECT id, status, preview, error_code
    FROM inbox_extract_jobs
    WHERE user_id = ${userId}
      AND canonical_url = ${canonicalUrl}
      AND (
        status IN ('queued', 'running')
        OR (status = 'succeeded' AND finished_at > now() - interval '1 hour')
      )
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = (rows.rows as Array<{
    id?: string;
    status?: string;
    preview?: InboxPreview | null;
    error_code?: string | null;
  }>)[0];
  if (row?.id === undefined || row.status === undefined) return null;
  return viewOf({
    id: row.id,
    status: row.status,
    preview: row.preview ?? null,
    errorCode: row.error_code ?? null,
  });
}

/**
 * Record an extract and return. Work runs after the response, and again when
 * a queued job is polled. Tests call `processQueuedExtractJobs` themselves.
 */
export async function startExtractJob(userId: string, rawUrl: string): Promise<ExtractJob> {
  const { canonicalUrl } = idempotencyKeyForUrl(rawUrl);
  const existing = await findReusable(userId, canonicalUrl);
  if (existing) return existing;
  const id = randomUUID();
  try {
    await getDb().insert(inboxExtractJobs).values({
      id,
      userId,
      url: rawUrl,
      canonicalUrl,
      status: 'queued',
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const again = await findReusable(userId, canonicalUrl);
    if (again) return again;
    throw err;
  }
  kickExtractJobs();
  return { id, status: 'queued', preview: null, errorCode: null };
}

function toListItem(row: {
  id: string;
  url: string;
  status: string;
  errorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}): ExtractJobListItem {
  const known = asStatus(row.status);
  const status = known ?? 'failed';
  return {
    id: row.id,
    url: row.url,
    status,
    errorCode: known === null ? 'EXTRACT_FAILED' : status === 'failed' ? row.errorCode : null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

/**
 * One page of jobs. In-flight rows first, then recently finished.
 * Omits the preview and does not start work.
 */
export async function listExtractJobs(
  userId: string,
  query: ListExtractJobsQuery,
): Promise<ExtractJobList> {
  const where = eq(inboxExtractJobs.userId, userId);
  const [summaryRows, rows] = await Promise.all([
    getDb()
      .select({
        total: sql<number>`count(*)::int`,
        activeCount: sql<number>`count(*) filter (where ${inboxExtractJobs.status} in ('queued', 'running'))::int`,
      })
      .from(inboxExtractJobs)
      .where(where),
    getDb()
      .select({
        id: inboxExtractJobs.id,
        url: inboxExtractJobs.url,
        status: inboxExtractJobs.status,
        errorCode: inboxExtractJobs.errorCode,
        createdAt: inboxExtractJobs.createdAt,
        startedAt: inboxExtractJobs.startedAt,
        finishedAt: inboxExtractJobs.finishedAt,
      })
      .from(inboxExtractJobs)
      .where(where)
      .orderBy(
        sql`case ${inboxExtractJobs.status} when 'running' then 0 when 'queued' then 1 else 2 end`,
        sql`case when ${inboxExtractJobs.status} in ('running', 'queued') then ${inboxExtractJobs.createdAt} end asc nulls last`,
        sql`${inboxExtractJobs.finishedAt} desc nulls last`,
        sql`${inboxExtractJobs.createdAt} desc`,
      )
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
  ]);
  const summary = summaryRows[0];
  return {
    items: rows.map(toListItem),
    page: query.page,
    pageSize: query.limit,
    total: summary?.total ?? 0,
    activeCount: summary?.activeCount ?? 0,
  };
}

export async function getExtractJob(userId: string, id: string): Promise<ExtractJob> {
  const [row] = await getDb()
    .select()
    .from(inboxExtractJobs)
    .where(and(eq(inboxExtractJobs.id, id), eq(inboxExtractJobs.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  if (row.status === 'queued') kickExtractJobs();
  return viewOf(row);
}

let kicking = false;
let kickAgain = false;

/** Another start/poll arrived while a batch was in flight. */
function pullKick(): boolean {
  if (!kickAgain) return false;
  kickAgain = false;
  return true;
}

export function kickExtractJobs(): void {
  if (!autoKick) return;
  kickAgain = true;
  if (kicking) return;
  kicking = true;
  void drainExtractJobs();
}

async function drainExtractJobs(): Promise<void> {
  try {
    while (pullKick()) {
      await processQueuedExtractJobs();
    }
  } catch (err) {
    logger.error('extract_job.failed', err);
  } finally {
    kicking = false;
    if (pullKick()) kickExtractJobs();
  }
}

async function failStale(): Promise<void> {
  await getDb().execute(sql`
    UPDATE inbox_extract_jobs
    SET status = 'failed', error_code = 'EXTRACT_FAILED', finished_at = now()
    WHERE status = 'running'
      AND started_at < now() - interval '3 minutes'
  `);
}

async function dropExpired(): Promise<void> {
  await getDb().execute(sql`
    DELETE FROM inbox_extract_jobs
    WHERE status IN ('succeeded', 'failed')
      AND finished_at < now() - interval '24 hours'
  `);
}

async function claimQueued(limit: number): Promise<ClaimedJob[]> {
  const now = new Date();
  return getDb().transaction(async (tx) => {
    const selected = await tx.execute(sql`
      SELECT id, url
      FROM inbox_extract_jobs
      WHERE status = 'queued'
      ORDER BY created_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    const claimed = (selected.rows as Array<{ id?: string; url?: string }>).flatMap((row) =>
      typeof row.id === 'string' && typeof row.url === 'string' ? [{ id: row.id, url: row.url }] : [],
    );
    if (claimed.length === 0) return [];
    await tx
      .update(inboxExtractJobs)
      .set({ status: 'running', startedAt: now })
      .where(
        and(
          inArray(
            inboxExtractJobs.id,
            claimed.map((row) => row.id),
          ),
          eq(inboxExtractJobs.status, 'queued'),
        ),
      );
    return claimed;
  });
}

async function complete(
  id: string,
  status: 'succeeded' | 'failed',
  preview: InboxPreview | null,
  errorCode: string | null,
): Promise<void> {
  await getDb()
    .update(inboxExtractJobs)
    .set({ status, preview, errorCode, finishedAt: new Date() })
    .where(and(eq(inboxExtractJobs.id, id), eq(inboxExtractJobs.status, 'running')));
}

async function runClaimed(job: ClaimedJob): Promise<void> {
  const started = Date.now();
  let host = '';
  try {
    host = new URL(job.url).hostname;
  } catch {
    host = '';
  }
  try {
    const loaded = await loadRenderedArticle(job.url);
    if (!hasUsefulBody(loaded.article)) {
      await complete(job.id, 'failed', null, 'EXTRACT_EMPTY');
      logger.info('extract_job', { host, status: 'failed', code: 'EXTRACT_EMPTY', ms: Date.now() - started });
      return;
    }
    await complete(job.id, 'succeeded', toInboxPreview(job.url, loaded), null);
    logger.info('extract_job', { host, status: 'succeeded', ms: Date.now() - started });
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'EXTRACT_FAILED';
    if (!(err instanceof AppError)) logger.warn('extract_job.failed', { id: job.id, err });
    await complete(job.id, 'failed', null, code);
    logger.info('extract_job', { host, status: 'failed', code, ms: Date.now() - started });
  }
}

/** Claim a small batch. Safe for the API process and the worker to call together. */
export async function processQueuedExtractJobs(): Promise<{ claimed: number }> {
  await failStale();
  await dropExpired();
  const claimed = await claimQueued(EXTRACT_JOB_BATCH);
  await Promise.all(claimed.map((job) => runClaimed(job)));
  return { claimed: claimed.length };
}
