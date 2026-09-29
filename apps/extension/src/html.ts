export { escapeParagraph, tidyArticleHtml } from '@vital/article-html';
export { clip, hostnameOf, parseDim, textFromHtml } from '@vital/article-extract';

export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
