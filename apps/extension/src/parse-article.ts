import { Readability } from '@mozilla/readability';
import { MAX_EXTRACT_HTML_BYTES, MAX_INBOX_ASSETS } from '@vital/dto';
import { extractSite, pack, type SiteExtract } from './extractors.js';
import { clip, escapeParagraph, hostnameOf, textFromHtml, tidyArticleHtml } from './html.js';
import { collectArticleImages } from './images.js';

/** Site-extractor HTML/text must beat this or we continue the generic pipeline. */
export const MIN_SITE_EXTRACT_CHARS = 20;

/** Semantic-root and Readability results below this are treated as too short. */
export const MIN_USEFUL_TEXT_CHARS = 140;

/** Skip semantic roots whose link text is more than this fraction of visible text. */
export const MAX_SEMANTIC_LINK_DENSITY = 0.5;

const SEMANTIC_ROOT_SELECTOR = [
  'article',
  'main',
  '[role="main"]',
  '.post',
  '.post-content',
  '.entry-content',
  '.article-content',
  '.article',
  '#content',
].join(', ');

export type ParseMode = 'article' | 'page';

export interface ParsedArticle {
  title: string;
  extractedHtml: string | null;
  extractedText: string | null;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
  imageSrcs: string[];
}

interface ParsedFields {
  title: string;
  extractedHtml: string | null;
  extractedText: string | null;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
}

function visibleTextLength(el: Element): number {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().length;
}

function linkTextLength(el: Element): number {
  let n = 0;
  for (const a of el.querySelectorAll('a')) {
    n += (a.textContent ?? '').replace(/\s+/g, ' ').trim().length;
  }
  return n;
}

/** Readability-style: longer text with fewer links scores higher. */
function contentScore(el: Element): number {
  const textLen = visibleTextLength(el);
  if (textLen === 0) return 0;
  const linkLen = Math.min(linkTextLength(el), textLen);
  return textLen * (1 - linkLen / textLen);
}

function linkDensity(el: Element): number {
  const textLen = visibleTextLength(el);
  if (textLen === 0) return 1;
  return Math.min(linkTextLength(el), textLen) / textLen;
}

function isUsefulExtract(site: SiteExtract | null): site is SiteExtract {
  return (
    site !== null &&
    (site.html.trim().length > MIN_SITE_EXTRACT_CHARS ||
      site.text.trim().length > MIN_SITE_EXTRACT_CHARS)
  );
}

function bodyPlainText(doc: Document): string {
  return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function shouldFallbackToBody(parsedText: string | null | undefined, bodyText: string): boolean {
  const parsedLen = parsedText?.replace(/\s+/g, ' ').trim().length ?? 0;
  if (parsedLen >= MIN_USEFUL_TEXT_CHARS) return false;
  return bodyText.length > parsedLen;
}

/**
 * Pick the densest common content root that has enough text. Null if none qualify.
 */
export function extractSemanticRoot(doc: Document): Element | null {
  let best: Element | null = null;
  let bestScore = 0;
  let bestLen = 0;
  for (const el of doc.querySelectorAll(SEMANTIC_ROOT_SELECTOR)) {
    const textLen = visibleTextLength(el);
    if (textLen < MIN_USEFUL_TEXT_CHARS) continue;
    if (linkDensity(el) > MAX_SEMANTIC_LINK_DENSITY) continue;
    const score = contentScore(el);
    if (best === null || score > bestScore || (score === bestScore && textLen > bestLen)) {
      best = el;
      bestScore = score;
      bestLen = textLen;
    }
  }
  return best;
}

function fromPacked(packed: SiteExtract, fallbackTitle: string): ParsedFields {
  const extractedHtml = clip(tidyArticleHtml(packed.html), MAX_EXTRACT_HTML_BYTES);
  const fromHtml = extractedHtml !== null ? textFromHtml(extractedHtml) : '';
  const extractedText = clip(fromHtml === '' ? packed.text : fromHtml, MAX_EXTRACT_HTML_BYTES);
  return {
    title: clip(packed.title, 500) ?? fallbackTitle,
    extractedHtml,
    extractedText,
    excerpt: clip(extractedText, 500),
    byline: clip(packed.byline, 200),
    siteName: clip(packed.siteName, 200),
  };
}

function finalize(fields: ParsedFields, originalHtml: string, url: string): ParsedArticle {
  let extractedHtml = fields.extractedHtml;
  const extractedText = fields.extractedText;
  if (extractedHtml === null && extractedText !== null) {
    extractedHtml = escapeParagraph(extractedText);
  }
  return {
    title: fields.title,
    extractedHtml,
    extractedText,
    excerpt: fields.excerpt ?? clip(extractedText, 500),
    byline: fields.byline,
    siteName: fields.siteName,
    imageSrcs: collectArticleImages(extractedHtml ?? originalHtml, url, MAX_INBOX_ASSETS),
  };
}

function fromReadability(
  doc: Document,
  url: string,
  fallbackTitle: string,
  originalHtml: string,
): ParsedArticle {
  const bodyText = bodyPlainText(doc);
  try {
    const clone = doc.cloneNode(true);
    if (!(clone instanceof Document)) {
      throw new Error('clone failed');
    }
    const article = new Readability(clone).parse();
    if (article !== null && !shouldFallbackToBody(article.textContent, bodyText)) {
      return finalize(
        {
          title: clip(article.title, 500) ?? fallbackTitle,
          extractedHtml: clip(tidyArticleHtml(article.content ?? ''), MAX_EXTRACT_HTML_BYTES),
          extractedText: clip(article.textContent, MAX_EXTRACT_HTML_BYTES),
          excerpt: clip(article.excerpt, 500),
          byline: clip(article.byline, 200),
          siteName: clip(article.siteName, 200),
        },
        originalHtml,
        url,
      );
    }
  } catch {
    // Body plain-text fallback below.
  }
  const extractedText = clip(bodyText, MAX_EXTRACT_HTML_BYTES);
  return finalize(
    {
      title: fallbackTitle,
      extractedHtml: null,
      extractedText,
      excerpt: clip(extractedText, 500),
      byline: null,
      siteName: null,
    },
    originalHtml,
    url,
  );
}

function parsePreparedDoc(
  doc: Document,
  url: string,
  fallbackTitle: string,
  originalHtml: string,
  mode: ParseMode,
): ParsedArticle {
  if (mode === 'page') {
    const root = extractSemanticRoot(doc) ?? doc.body;
    const packed = pack(fallbackTitle, root, { siteName: hostnameOf(url) }, url);
    if (packed === null) {
      return finalize(
        {
          title: fallbackTitle,
          extractedHtml: null,
          extractedText: null,
          excerpt: null,
          byline: null,
          siteName: hostnameOf(url),
        },
        originalHtml,
        url,
      );
    }
    return finalize(fromPacked(packed, fallbackTitle), originalHtml, url);
  }

  const site = extractSite(doc, url);
  if (isUsefulExtract(site)) {
    return finalize(fromPacked(site, fallbackTitle), originalHtml, url);
  }

  const semantic = extractSemanticRoot(doc);
  if (semantic !== null) {
    const packed = pack(fallbackTitle, semantic, { siteName: hostnameOf(url) }, url);
    if (isUsefulExtract(packed)) {
      return finalize(fromPacked(packed, fallbackTitle), originalHtml, url);
    }
  }

  return fromReadability(doc, url, fallbackTitle, originalHtml);
}

/**
 * Spec: SW sends outerHTML string to offscreen; DOMParser.parseFromString, then
 * site registry → semantic root → Readability → body text (article), or
 * semantic root / body without Readability (page).
 * Image URLs are collected from the article HTML (cap 10, skip tracking pixels).
 */
export function parseArticle(
  html: string,
  url: string,
  mode: ParseMode = 'article',
): ParsedArticle {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.setAttribute('href', url);
  doc.head.prepend(base);
  const fallbackTitle = clip(doc.title, 500) ?? hostnameOf(url) ?? url;
  return parsePreparedDoc(doc, url, fallbackTitle, html, mode);
}

export function parseCapture(
  html: string,
  url: string,
): { article: ParsedArticle; page: ParsedArticle } {
  return {
    article: parseArticle(html, url, 'article'),
    page: parseArticle(html, url, 'page'),
  };
}
