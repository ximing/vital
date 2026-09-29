import type { InboxPreview } from '@vital/dto';
import { AppError } from '../errors.js';
import { idempotencyKeyForUrl } from '../inbox/canonical.js';
import { logger } from '../utils/logger.js';
import { loadRenderedArticle, type LoadedArticle } from './rendered.js';
import { extractSemaphore } from './semaphore.js';

export function toInboxPreview(rawUrl: string, loaded: LoadedArticle): InboxPreview {
  const { canonicalUrl } = idempotencyKeyForUrl(loaded.url.href);
  const article = loaded.article;
  return {
    title: article.title,
    outcomeId: null,
    originalUrl: rawUrl,
    canonicalUrl,
    extractedText: article.text,
    contentJson: article.doc,
    excerpt: article.excerpt,
    byline: article.byline,
    siteName: article.siteName,
    status: 'unread',
    source: 'web',
    readAt: null,
    convertedTaskId: null,
    inwitDocumentId: null,
    inwitExportedAt: null,
    tagIds: [],
    assets: [],
  };
}

/**
 * Paste preview. Obscura renders JS pages; the wait starts after a semaphore
 * slot is free so queue time does not eat the navigation budget.
 */
export async function extractUrl(rawUrl: string): Promise<InboxPreview> {
  let host = '';
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  await extractSemaphore.acquire();
  const started = Date.now();
  try {
    const loaded = await loadRenderedArticle(rawUrl);
    return toInboxPreview(rawUrl, loaded);
  } finally {
    extractSemaphore.release();
    logger.info('extract_ms', { host, ms: Date.now() - started });
  }
}
