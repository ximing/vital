import { MAX_UPLOAD_BYTES } from '@vital/dto';

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

const FILE_MIME = /^(application\/pdf|video\/|audio\/)/;

/** Direct-file gate: whitelisted kind + known length + within cap. */
export function fileModeFromResponse(
  url: string,
  contentType: string,
  contentLength: number | null,
): DirectFile | null {
  const mime = contentType.split(';')[0]?.trim() ?? '';
  if (!FILE_MIME.test(mime)) return null;
  if (contentLength === null || contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
    return null;
  }
  return { url, mime, size: contentLength };
}
