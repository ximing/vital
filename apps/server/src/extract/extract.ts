import { Readability } from '@mozilla/readability';
import type { InboxPreview } from '@vital/dto';
import { JSDOM } from 'jsdom';
import { AppError } from '../errors.js';
import { idempotencyKeyForUrl } from '../inbox/canonical.js';
import { sanitizeExtractedHtml } from '../inbox/sanitize.js';
import { logger } from '../utils/logger.js';
import { fetchHtml } from './fetch.js';
import { EXTRACT_TIMEOUT_MS } from './ssrf.js';
import { extractSemaphore } from './semaphore.js';

function clip(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function parseArticle(html: string, url: URL): {
  title: string;
  text: string | null;
  html: string | null;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
} {
  const dom = new JSDOM(html, { url: url.href, contentType: 'text/html' });
  try {
    const document = dom.window.document;
    const article = new Readability(document).parse();
    const title =
      clip(article?.title, 500) ?? clip(document.title, 500) ?? clip(url.hostname, 500) ?? url.href;
    const text = clip(article?.textContent ?? null, 2 * 1024 * 1024);
    const rawHtml = article?.content ?? null;
    const extractedHtml = rawHtml ? sanitizeExtractedHtml(rawHtml) : null;
    return {
      title,
      text,
      html: extractedHtml === '' ? null : extractedHtml,
      excerpt: clip(article?.excerpt, 500),
      byline: clip(article?.byline, 200),
      siteName: clip(article?.siteName, 200),
    };
  } finally {
    dom.window.close();
  }
}

/**
 * v1 exception vs Moment worker-only getObject: HTML ingest runs on the
 * request thread, capped at 10s / 2MB and a process semaphore of 2.
 */
export async function extractUrl(rawUrl: string): Promise<InboxPreview> {
  let host = '';
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  await extractSemaphore.acquire();
  // 10s is ingest time; queued wait for the semaphore must not burn the budget.
  const started = Date.now();
  try {
    const fetched = await fetchHtml(rawUrl, EXTRACT_TIMEOUT_MS);
    const article = parseArticle(fetched.html, fetched.url);
    const { canonicalUrl } = idempotencyKeyForUrl(fetched.url.href);
    return {
      title: article.title,
      originalUrl: rawUrl,
      canonicalUrl,
      extractedText: article.text,
      extractedHtml: article.html,
      excerpt: article.excerpt ?? clip(article.text, 500),
      byline: article.byline,
      siteName: article.siteName,
      status: 'unread',
      source: 'web',
      readAt: null,
      convertedTaskId: null,
      assets: [],
    };
  } finally {
    extractSemaphore.release();
    logger.info('extract_ms', { host, ms: Date.now() - started });
  }
}
