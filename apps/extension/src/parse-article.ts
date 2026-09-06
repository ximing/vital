import { Readability } from '@mozilla/readability';
import { MAX_EXTRACT_HTML_BYTES, MAX_INBOX_ASSETS } from '@vital/dto';
import { extractSite } from './extractors.js';
import { clip, escapeParagraph, hostnameOf } from './html.js';
import { collectArticleImages } from './images.js';

export interface ParsedArticle {
  title: string;
  extractedHtml: string | null;
  extractedText: string | null;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
  imageSrcs: string[];
}

/**
 * Spec: SW sends outerHTML string to offscreen; DOMParser.parseFromString + Readability.
 * Image URLs are collected from the article HTML (cap 10, skip tracking pixels).
 */
export function parseArticle(html: string, url: string): ParsedArticle {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.setAttribute('href', url);
  doc.head.prepend(base);

  const fallbackTitle = clip(doc.title, 500) ?? hostnameOf(url) ?? url;
  let title = fallbackTitle;
  let extractedHtml: string | null = null;
  let extractedText: string | null = null;
  let excerpt: string | null = null;
  let byline: string | null = null;
  let siteName: string | null = null;

  const site = extractSite(doc, url);
  if (site !== null && (site.html.trim().length > 20 || site.text.trim().length > 20)) {
    title = clip(site.title, 500) ?? fallbackTitle;
    extractedHtml = clip(site.html, MAX_EXTRACT_HTML_BYTES);
    extractedText = clip(site.text, MAX_EXTRACT_HTML_BYTES);
    excerpt = clip(site.text, 500);
    byline = clip(site.byline, 200);
    siteName = clip(site.siteName, 200);
  } else {
    try {
      const clone = doc.cloneNode(true);
      if (!(clone instanceof Document)) {
        throw new Error('clone failed');
      }
      const article = new Readability(clone).parse();
      if (article !== null) {
        title = clip(article.title, 500) ?? fallbackTitle;
        extractedHtml = clip(article.content, MAX_EXTRACT_HTML_BYTES);
        extractedText = clip(article.textContent, MAX_EXTRACT_HTML_BYTES);
        excerpt = clip(article.excerpt, 500);
        byline = clip(article.byline, 200);
        siteName = clip(article.siteName, 200);
      }
    } catch {
      const bodyText = doc.body?.textContent ?? '';
      extractedText = clip(bodyText.replace(/\s+/g, ' ').trim(), MAX_EXTRACT_HTML_BYTES);
      excerpt = clip(extractedText, 500);
    }
  }

  if (extractedHtml === null && extractedText !== null) {
    extractedHtml = escapeParagraph(extractedText);
  }

  const imageHtml = extractedHtml ?? html;
  const imageSrcs = collectArticleImages(imageHtml, url, MAX_INBOX_ASSETS);

  return {
    title,
    extractedHtml,
    extractedText,
    excerpt: excerpt ?? clip(extractedText, 500),
    byline,
    siteName,
    imageSrcs,
  };
}
