import type { InboxAsset } from '@vital/dto';
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'a',
  'p',
  'br',
  'span',
  'div',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'code',
  'img',
  'figure',
  'figcaption',
  'hr',
];

const ALLOWED_ATTR = ['href', 'title', 'rel', 'src', 'alt', 'width', 'height'];

/** http(s)/mailto plus relative paths; never javascript: or data:. */
const ALLOWED_URI = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

const UPLOAD_RE =
  /\/api\/v1\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

export function purifyInboxHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
  });
}

export function textToHtml(text: string): string {
  const escaped = text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replaceAll('\n', '<br>')}</p>`)
    .join('');
}

export function readerSourceHtml(html: string | null, text: string | null): string {
  if (html !== null && html.trim() !== '') return html;
  if (text !== null && text.trim() !== '') return textToHtml(text);
  return '';
}

export async function rewriteInboxImages(
  html: string,
  assets: InboxAsset[],
  fetchBlob: (id: string) => Promise<Blob>,
): Promise<{ html: string; objectUrls: string[] }> {
  if (html === '') return { html: '', objectUrls: [] };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const objectUrls: string[] = [];
  const bySrc = new Map(assets.map((asset) => [asset.originalSrc, asset]));
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src');
    if (src === null || src === '') continue;
    let attachmentId = bySrc.get(src)?.attachmentId ?? null;
    if (attachmentId === null) {
      const match = UPLOAD_RE.exec(src);
      attachmentId = match?.[1] ?? null;
    }
    if (attachmentId === null) continue;
    try {
      const blob = await fetchBlob(attachmentId);
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      img.setAttribute('src', url);
    } catch {
      // Keep the purified original src.
    }
  }
  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  return { html: doc.body.innerHTML, objectUrls };
}

export async function prepareReaderHtml(
  html: string | null,
  text: string | null,
  assets: InboxAsset[],
  fetchBlob: (id: string) => Promise<Blob>,
): Promise<{ html: string; objectUrls: string[] }> {
  const purified = purifyInboxHtml(readerSourceHtml(html, text));
  return rewriteInboxImages(purified, assets, fetchBlob);
}
