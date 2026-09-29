import { AppError } from '../errors.js';
import { parseRenderedArticle, type ParsedPreviewFields } from './article.js';
import { fetchHtml, lookupPinned } from './fetch.js';
import {
  OBSCURA_RETRY_TIMEOUT_SEC,
  OBSCURA_RETRY_WAIT_SEC,
  OBSCURA_TIMEOUT_SEC,
  OBSCURA_WAIT_SEC,
  ObscuraUnavailable,
  runObscura,
  type ObscuraFailureReason,
  type ObscuraPage,
} from './obscura.js';
import { EXTRACT_TIMEOUT_MS, assertSafeUrl, hostnameOf } from './ssrf.js';

export interface LoadedArticle {
  url: URL;
  article: ParsedPreviewFields;
  /** `missing` means the binary was not on PATH. `failed` is a crash or timeout. */
  obscura: 'ok' | ObscuraFailureReason;
}

interface Attempt {
  url: URL;
  article: ParsedPreviewFields;
}

/**
 * Obscura resolves DNS itself, so this check is not a connect pin. Redirects are
 * checked again via location.href. The process is not started with
 * --allow-private-network, which blocks loopback and private ranges on its side.
 */
async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  assertSafeUrl(url);
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, EXTRACT_TIMEOUT_MS);
  try {
    await lookupPinned(hostnameOf(url), ac.signal);
    return url;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.of(400, 'VALIDATION_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

async function acceptLocation(page: ObscuraPage): Promise<Attempt> {
  const url = await assertPublicHttpUrl(page.href);
  return {
    url,
    article: parseRenderedArticle(page.html, url, page.title),
  };
}

async function renderOnce(rawUrl: string, waitSec: number, timeoutSec: number): Promise<Attempt> {
  const page = await runObscura({ url: rawUrl, waitSec, timeoutSec });
  return acceptLocation(page);
}

async function plainHttp(rawUrl: string, obscura: ObscuraFailureReason): Promise<LoadedArticle> {
  const fetched = await fetchHtml(rawUrl, EXTRACT_TIMEOUT_MS);
  return {
    url: fetched.url,
    article: parseRenderedArticle(fetched.html, fetched.url, ''),
    obscura,
  };
}

/**
 * Render with Obscura, then parse. A thin or blocked page is retried once with
 * a longer wait. Plain HTTP runs only when Obscura cannot start, crashes, or
 * times out — a rendered shell is not replaced with the pre-JS document.
 */
export async function loadRenderedArticle(rawUrl: string): Promise<LoadedArticle> {
  await assertPublicHttpUrl(rawUrl);
  try {
    const first = await renderOnce(rawUrl, OBSCURA_WAIT_SEC, OBSCURA_TIMEOUT_SEC);
    if (first.article.useful) return { url: first.url, article: first.article, obscura: 'ok' };
    try {
      const second = await renderOnce(rawUrl, OBSCURA_RETRY_WAIT_SEC, OBSCURA_RETRY_TIMEOUT_SEC);
      return { url: second.url, article: second.article, obscura: 'ok' };
    } catch (err) {
      if (err instanceof AppError) throw err;
      return { url: first.url, article: first.article, obscura: 'ok' };
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof ObscuraUnavailable) return plainHttp(rawUrl, err.reason);
    throw err;
  }
}
