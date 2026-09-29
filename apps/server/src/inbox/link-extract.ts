import { MIN_USEFUL_TEXT_CHARS } from '@vital/article-extract';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { inboxItems } from '../db/schema.js';
import { loadRenderedArticle } from '../extract/rendered.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { fillEmptyInboxFromExtract } from './inbox.service.js';

const LINK_EXTRACT_BATCH = 2;

/** Process-lifetime: a missing binary should not undici-scan the backlog every heal. */
let obscuraMissingForProcess = false;

/** Test seam. Do not call from product code. */
export function resetLinkExtractForTests(): void {
  obscuraMissingForProcess = false;
}

interface ClaimedLink {
  id: string;
  originalUrl: string;
}

async function claimLinkOnly(limit: number): Promise<ClaimedLink[]> {
  const now = new Date();
  return getDb().transaction(async (tx) => {
    const selected = await tx.execute(sql`
      SELECT i.id, i.original_url
      FROM inbox_items i
      LEFT JOIN inbox_item_bodies b ON b.inbox_item_id = i.id
      WHERE i.deleted_at IS NULL
        AND i.link_extract_attempted_at IS NULL
        AND i.original_url IS NOT NULL
        AND (
          lower(i.original_url) LIKE 'http://%'
          OR lower(i.original_url) LIKE 'https://%'
        )
        AND (
          b.inbox_item_id IS NULL
          OR (
            char_length(coalesce(b.extracted_text, '')) < ${MIN_USEFUL_TEXT_CHARS}
            AND (
              b.content_json IS NULL
              OR b.content_json = 'null'::jsonb
              OR (
                jsonb_typeof(b.content_json) = 'object'
                AND CASE
                  WHEN jsonb_typeof(b.content_json->'content') = 'array'
                    THEN jsonb_array_length(b.content_json->'content') = 0
                  ELSE b.content_json->'content' IS NULL
                END
              )
            )
          )
        )
      ORDER BY i.captured_at, i.id
      LIMIT ${limit}
      FOR UPDATE OF i SKIP LOCKED
    `);
    const ids = (selected.rows as Array<{ id?: string; original_url?: string }>)
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) return [];
    const rows = await tx
      .update(inboxItems)
      .set({ linkExtractAttemptedAt: now })
      .where(and(inArray(inboxItems.id, ids), sql`${inboxItems.linkExtractAttemptedAt} IS NULL`))
      .returning({ id: inboxItems.id, originalUrl: inboxItems.originalUrl });
    return rows.flatMap((row) => (row.originalUrl === null ? [] : [{ id: row.id, originalUrl: row.originalUrl }]));
  });
}

async function clearAttempt(id: string): Promise<void> {
  await getDb()
    .update(inboxItems)
    .set({ linkExtractAttemptedAt: null })
    .where(eq(inboxItems.id, id));
}

/**
 * Fill saved link-only inbox rows. Two per heal. A failed render stays marked
 * so it is not fetched again. A missing Obscura binary clears the mark and
 * pauses until the worker process restarts.
 */
export async function backfillLinkOnlyInbox(): Promise<{ claimed: number; filled: number }> {
  if (obscuraMissingForProcess) return { claimed: 0, filled: 0 };
  const claimed = await claimLinkOnly(LINK_EXTRACT_BATCH);
  let filled = 0;
  for (const row of claimed) {
    try {
      const loaded = await loadRenderedArticle(row.originalUrl);
      if (loaded.obscura === 'missing') obscuraMissingForProcess = true;
      const article = loaded.article;
      if (!article.useful || (article.doc === null && (article.text === null || article.text.trim() === ''))) {
        if (loaded.obscura === 'missing') await clearAttempt(row.id);
        continue;
      }
      const saved = await fillEmptyInboxFromExtract(row.id, {
        title: article.title,
        excerpt: article.excerpt,
        byline: article.byline,
        siteName: article.siteName,
        extractedText: article.text,
        contentJson: article.doc,
      });
      if (saved !== null) filled += 1;
    } catch (err) {
      if (!(err instanceof AppError)) logger.warn('link_extract.failed', { id: row.id, err });
      else logger.info('link_extract.skipped', { id: row.id });
    }
  }
  return { claimed: claimed.length, filled };
}
