import { htmlToArticleDoc, textToArticleDoc, type ArticleDoc } from '@vital/article-doc';
import {
  MAX_SEMANTIC_LINK_DENSITY,
  MIN_SITE_EXTRACT_CHARS,
  MIN_USEFUL_TEXT_CHARS,
  extractSite,
  parseArticle,
} from '@vital/article-extract';
import { MAX_EXTRACT_HTML_BYTES } from '@vital/dto';
import { installExtractDom } from './dom.js';

export interface ParsedPreviewFields {
  title: string;
  text: string | null;
  doc: ArticleDoc | null;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
  useful: boolean;
}

const CHALLENGE_MARK =
  /cf-turnstile|challenges\.cloudflare|cf-browser-verification|hcaptcha|g-recaptcha|__cf_chl/i;
const CHALLENGE_TITLE = /^(just a moment|attention required|access denied|sign in|log in|login|登录|登入|安全验证|验证码)\b/i;

function clip(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

export function isChallengePage(html: string, titles: readonly string[]): boolean {
  const head = html.slice(0, 12_000);
  if (CHALLENGE_MARK.test(head)) return true;
  const named = titles.some((title) => /^(just a moment|attention required)\b/i.test(title.trim()));
  if (named) return true;
  const password = /type=["']password["']/i.test(head);
  return password && titles.some((title) => CHALLENGE_TITLE.test(title.trim()));
}

function pageLinkDensity(html: string): number {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = doc.body.textContent.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return 1;
  let links = 0;
  for (const anchor of doc.querySelectorAll('a')) {
    links += anchor.textContent.replace(/\s+/g, ' ').trim().length;
  }
  return Math.min(links, text.length) / text.length;
}

function siteMatched(html: string, pageUrl: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.setAttribute('href', pageUrl);
  doc.head.prepend(base);
  const site = extractSite(doc, pageUrl);
  if (site === null) return false;
  return (
    site.html.trim().length > MIN_SITE_EXTRACT_CHARS ||
    site.text.trim().length > MIN_SITE_EXTRACT_CHARS
  );
}

function fallbackTitle(hinted: string, pageUrl: URL, challenge: boolean): string {
  if (challenge) return pageUrl.hostname || pageUrl.href;
  const hint = clip(hinted, 500);
  if (hint !== null) return hint;
  return pageUrl.hostname || pageUrl.href;
}

/**
 * Same pipeline as the extension (site → semantic root → Readability → tidy),
 * then drop login walls and link-only chrome before anything is stored.
 */
export function parseRenderedArticle(html: string, pageUrl: URL, hintedTitle: string): ParsedPreviewFields {
  installExtractDom();
  const parsed = parseArticle(html, pageUrl.href, 'article');
  const text = clip(parsed.extractedText, MAX_EXTRACT_HTML_BYTES);
  const textLen = text?.length ?? 0;
  const challenge = isChallengePage(html, [hintedTitle, parsed.title]);
  const matched = siteMatched(html, pageUrl.href);
  const dense = !matched && pageLinkDensity(html) > MAX_SEMANTIC_LINK_DENSITY;
  const useful = textLen >= MIN_USEFUL_TEXT_CHARS && !challenge && !dense;
  if (!useful) {
    return {
      title: fallbackTitle(hintedTitle || parsed.title, pageUrl, challenge),
      text: null,
      doc: null,
      excerpt: null,
      byline: null,
      siteName: null,
      useful: false,
    };
  }
  const rawHtml = clip(parsed.extractedHtml, MAX_EXTRACT_HTML_BYTES);
  let doc: ArticleDoc | null = null;
  try {
    doc = rawHtml !== null ? htmlToArticleDoc(rawHtml) : null;
  } catch {
    doc = null;
  }
  if (doc !== null && doc.content.length === 0) doc = null;
  if (doc === null && text !== null) doc = textToArticleDoc(text);
  return {
    title: clip(parsed.title, 500) ?? fallbackTitle(hintedTitle, pageUrl, false),
    text,
    doc,
    excerpt: clip(parsed.excerpt ?? text, 500),
    byline: clip(parsed.byline, 200),
    siteName: clip(parsed.siteName, 200),
    useful: doc !== null || text !== null,
  };
}
