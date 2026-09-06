import { OFFSCREEN_PATH } from './config.js';
import { base64ToBytes, blobToBase64, bytesToArrayBuffer } from './images.js';
import {
  isOffscreenConvert,
  isOffscreenParse,
  type OffscreenConvertRequest,
  type OffscreenParseRequest,
} from './messages.js';
import type { ParsedArticle } from './parse-article.js';

let creating: Promise<void> | null = null;

async function hasOffscreen(): Promise<boolean> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  return contexts.length > 0;
}

export async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  if (creating !== null) {
    await creating;
    return;
  }
  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.DOM_PARSER, chrome.offscreen.Reason.BLOBS],
    justification: 'Parse captured HTML and convert images before S3 rehost',
  });
  try {
    await creating;
  } finally {
    creating = null;
  }
}

function isParsedArticle(value: unknown): value is ParsedArticle {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.title === 'string' && Array.isArray(rec.imageSrcs);
}

export async function parseInOffscreen(html: string, url: string): Promise<ParsedArticle> {
  await ensureOffscreen();
  const request: OffscreenParseRequest = { type: 'parse', target: 'offscreen', html, url };
  const result: unknown = await chrome.runtime.sendMessage(request);
  if (!isParsedArticle(result)) {
    throw new Error('offscreen parse failed');
  }
  return result;
}

export async function convertInOffscreen(blob: Blob): Promise<{ mime: string; blob: Blob }> {
  await ensureOffscreen();
  const request: OffscreenConvertRequest = {
    type: 'convert-image',
    target: 'offscreen',
    mime: blob.type,
    data: await blobToBase64(blob),
  };
  const result: unknown = await chrome.runtime.sendMessage(request);
  if (typeof result !== 'object' || result === null) throw new Error('convert failed');
  const rec = result as Record<string, unknown>;
  if (typeof rec.data !== 'string' || typeof rec.mime !== 'string')
    throw new Error('convert failed');
  const bytes = base64ToBytes(rec.data);
  return { mime: rec.mime, blob: new Blob([bytesToArrayBuffer(bytes)], { type: rec.mime }) };
}

export { isOffscreenParse, isOffscreenConvert };
