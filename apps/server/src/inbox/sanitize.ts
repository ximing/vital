import { sanitizeHtmlConfig } from '@vital/article-html';
import sanitizeHtml from 'sanitize-html';

export { escapeParagraph } from '@vital/article-html';

export function sanitizeExtractedHtml(html: string): string {
  return sanitizeHtml(html, sanitizeHtmlConfig());
}
