import { INBOX_ASSET_MIME_TYPES } from '@vital/dto';

export {
  canonicalizeImageSrc,
  collectArticleImages,
  imageSrcFrom,
  imageSrcKey,
  isTrackingPixel,
  largestSrcset,
  promoteLazyImages,
  promoteMedia,
} from '@vital/article-extract';

/** Tiny payload is almost always a tracking pixel / spacer. */
export const MIN_IMAGE_BYTES = 150;

const KEEP_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function shouldConvertImage(mime: string | null): boolean {
  if (mime === null) return true;
  return !KEEP_MIME.has(mime);
}

export function normalizeMime(headerMime: string, bytes: ArrayBuffer): string | null {
  const header = headerMime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (header === 'image/jpg') {
    return 'image/jpeg';
  }
  if ((INBOX_ASSET_MIME_TYPES as readonly string[]).includes(header)) {
    return header;
  }
  return sniffMime(bytes);
}

function byte(u8: Uint8Array, i: number): number {
  return u8[i] ?? -1;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function convertRasterToJpeg(bytes: Uint8Array): Promise<Blob | null> {
  const bitmap = await createImageBitmap(new Blob([bytesToArrayBuffer(bytes)]));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.88);
  });
}

export function sniffMime(bytes: ArrayBuffer): string | null {
  const u8 = new Uint8Array(bytes);
  if (u8.length < 12) return null;
  if (byte(u8, 0) === 0xff && byte(u8, 1) === 0xd8 && byte(u8, 2) === 0xff) return 'image/jpeg';
  if (
    byte(u8, 0) === 0x89 &&
    byte(u8, 1) === 0x50 &&
    byte(u8, 2) === 0x4e &&
    byte(u8, 3) === 0x47
  ) {
    return 'image/png';
  }
  if (
    byte(u8, 0) === 0x47 &&
    byte(u8, 1) === 0x49 &&
    byte(u8, 2) === 0x46 &&
    byte(u8, 3) === 0x38
  ) {
    return 'image/gif';
  }
  if (
    byte(u8, 0) === 0x52 &&
    byte(u8, 1) === 0x49 &&
    byte(u8, 2) === 0x46 &&
    byte(u8, 3) === 0x46 &&
    byte(u8, 8) === 0x57 &&
    byte(u8, 9) === 0x45 &&
    byte(u8, 10) === 0x42 &&
    byte(u8, 11) === 0x50
  ) {
    return 'image/webp';
  }
  if (
    byte(u8, 4) === 0x66 &&
    byte(u8, 5) === 0x74 &&
    byte(u8, 6) === 0x79 &&
    byte(u8, 7) === 0x70
  ) {
    return 'video/mp4';
  }
  if (byte(u8, 0) === 0x1a && byte(u8, 1) === 0x45 && byte(u8, 2) === 0xdf && byte(u8, 3) === 0xa3) {
    return 'video/webm';
  }
  return null;
}
