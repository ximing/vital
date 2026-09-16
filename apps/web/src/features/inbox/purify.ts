import { domPurifyConfig, textToHtml, tidyArticleHtml } from '@vital/article-html';
import { imageSrcKeys, type InboxAsset } from '@vital/dto';
import DOMPurify from 'dompurify';

export { textToHtml, tidyArticleHtml };

const DATA_URI_MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'SOURCE']);
const DATA_URI_MEDIA_ATTRS = new Set(['src', 'poster', 'srcset']);

/** DOMPurify hard-allows data: on img/video/source; strip to match sanitize-html. */
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (!DATA_URI_MEDIA_TAGS.has(node.tagName)) return;
  if (!DATA_URI_MEDIA_ATTRS.has(data.attrName)) return;
  if (/^\s*data:/i.test(data.attrValue)) data.keepAttr = false;
});

const UPLOAD_RE =
  /\/api\/v1\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

export function purifyInboxHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, domPurifyConfig());
  return tidyArticleHtml(clean);
}

export function readerSourceHtml(html: string | null, text: string | null): string {
  if (html !== null && html.trim() !== '') return html;
  if (text !== null && text.trim() !== '') return textToHtml(text);
  return '';
}

export async function rewriteInboxImages(
  html: string,
  assets: InboxAsset[],
): Promise<{ html: string; objectUrls: string[] }> {
  if (html === '') return { html: '', objectUrls: [] };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const objectUrls: string[] = [];
  const bySrc = new Map<string, InboxAsset>();
  for (const asset of assets) {
    for (const key of imageSrcKeys(asset.originalSrc)) {
      if (!bySrc.has(key)) bySrc.set(key, asset);
    }
  }
  const resolveAssetUrl = (src: string): string | null => {
    for (const key of imageSrcKeys(src)) {
      const hit = bySrc.get(key);
      if (hit?.url) return hit.url;
    }
    const match = UPLOAD_RE.exec(src);
    const attachmentId = match?.[1] ?? null;
    if (attachmentId === null) return null;
    return assets.find((candidate) => candidate.attachmentId === attachmentId)?.url ?? null;
  };
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src');
    if (src === null || src === '') continue;
    const url = resolveAssetUrl(src);
    if (url !== null) img.setAttribute('src', url);
  }
  for (const video of Array.from(doc.querySelectorAll('video'))) {
    const src = video.getAttribute('src');
    if (src !== null && src !== '') {
      const url = resolveAssetUrl(src);
      if (url !== null) video.setAttribute('src', url);
    }
    const poster = video.getAttribute('poster');
    if (poster !== null && poster !== '') {
      const url = resolveAssetUrl(poster);
      if (url !== null) video.setAttribute('poster', url);
    }
  }
  for (const source of Array.from(doc.querySelectorAll('source[src]'))) {
    const src = source.getAttribute('src');
    if (src === null || src === '') continue;
    const url = resolveAssetUrl(src);
    if (url !== null) source.setAttribute('src', url);
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
): Promise<{ html: string; objectUrls: string[] }> {
  const purified = purifyInboxHtml(readerSourceHtml(html, text));
  return rewriteInboxImages(purified, assets);
}
