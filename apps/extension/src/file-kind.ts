import { MAX_UPLOAD_BYTES, isUploadableMime } from '@vital/dto';

const EXT_TO_KIND: Record<string, 'pdf' | 'video' | 'audio'> = {
  pdf: 'pdf',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', wav: 'audio', flac: 'audio',
};

export function fileKindOf(url: string): 'pdf' | 'video' | 'audio' | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const ext = parsed.pathname.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_KIND[ext] ?? null;
}

export interface DirectFile {
  url: string;
  mime: string;
  size: number;
}

/** Direct-file gate: pdf/video/audio mime only, known length, within cap. */
export function fileModeFromResponse(
  url: string,
  contentType: string,
  contentLength: number | null,
): DirectFile | null {
  const mime = contentType.split(';')[0]?.trim() ?? '';
  // Images and text stay in article mode (a text/plain body would render an
  // invisible file in the Reader); the upload whitelist is stricter than any
  // video/* or audio/* prefix match, so reuse it instead of a regex.
  if (
    mime.startsWith('image/') ||
    mime.startsWith('text/') ||
    !isUploadableMime(mime)
  ) {
    return null;
  }
  if (
    contentLength === null ||
    !Number.isFinite(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_UPLOAD_BYTES
  ) {
    return null;
  }
  return { url, mime, size: contentLength };
}
