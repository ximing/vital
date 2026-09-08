import {
  ERROR_MESSAGES,
  MAX_UPLOAD_BYTES,
  isUploadableMime,
  type PartPresignResponse,
  type UploadCompleteResponse,
  type UploadInitResponse,
} from '@vital/dto';
import type { Http } from './http.js';
import { ApiError, type VitalClientOptions } from './types.js';

export interface UploadInput {
  /** Whole-file blob (web/extension, small files). */
  file?: Blob;
  /** Lazy part fetcher (streaming/5GB). Called with ascending [start, end). */
  partSource?: (start: number, end: number) => Promise<Blob>;
  mime: string;
  size: number;
  onProgress?: (loaded: number, total: number) => void;
  /** Fired after init succeeds and before the first PUT (caller can abort/discard). */
  onAttachmentId?: (id: string) => void;
  signal?: AbortSignal;
  /** Resume a previous multipart session; uploaded parts are skipped. */
  resumeId?: string;
}

async function initSession(
  http: Http,
  input: UploadInput,
  withResume: boolean,
): Promise<UploadInitResponse> {
  return http.request<UploadInitResponse>('/api/v1/uploads', {
    method: 'POST',
    body: {
      mime: input.mime,
      size: input.size,
      ...(withResume && input.resumeId !== undefined ? { resumeId: input.resumeId } : {}),
    },
  });
}

export async function uploadImpl(
  http: Http,
  options: VitalClientOptions,
  input: UploadInput,
): Promise<UploadCompleteResponse> {
  if (input.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, 'MEDIA_TOO_LARGE', ERROR_MESSAGES.MEDIA_TOO_LARGE);
  }
  if (!isUploadableMime(input.mime)) {
    throw new ApiError(422, 'MEDIA_MISMATCH', ERROR_MESSAGES.MEDIA_MISMATCH);
  }
  if (input.file === undefined && input.partSource === undefined) {
    throw new ApiError(0, 'UPLOAD_INPUT_INVALID', 'file 与 partSource 必须提供其一');
  }

  let init: UploadInitResponse;
  try {
    init = await initSession(http, input, true);
  } catch (err) {
    // Stale/mismatched resume session → fall back to a fresh one.
    if (input.resumeId !== undefined && err instanceof ApiError && err.status === 409) {
      init = await initSession(http, input, false);
    } else {
      throw err;
    }
  }
  input.onAttachmentId?.(init.id);

  const etags = new Map<number, string>();
  let loaded = 0;
  for (const p of init.parts) {
    // An empty etag means the part never finished server-side: re-upload it.
    if (p.etag === '') continue;
    etags.set(p.partNumber, p.etag);
    loaded += p.size; // resumed base so progress does not restart from 0
  }
  input.onProgress?.(loaded, input.size);

  for (let n = 1; n <= init.totalParts; n += 1) {
    if (etags.has(n)) continue;
    const start = (n - 1) * init.partSize;
    const end = Math.min(n * init.partSize, input.size);
    const presigned = await http.request<PartPresignResponse>(
      `/api/v1/uploads/${init.id}/parts/${String(n)}`,
      { method: 'POST', body: {} },
    );
    let body: Blob;
    if (input.partSource !== undefined) {
      body = await input.partSource(start, end);
    } else if (input.file !== undefined) {
      body = input.file.slice(start, end);
    } else {
      throw new ApiError(0, 'UPLOAD_INPUT_INVALID', 'file 与 partSource 必须提供其一');
    }
    const res = await (options.fetchImpl ?? fetch)(presigned.url, {
      method: 'PUT',
      headers: { 'Content-Type': input.mime },
      body,
      credentials: 'omit',
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });
    if (!res.ok) {
      throw new ApiError(res.status, 'UPLOAD_FAILED', `直传失败（${String(res.status)}）`);
    }
    const etag = res.headers.get('ETag');
    if (etag === null || etag === '') {
      throw new ApiError(0, 'UPLOAD_ETAG_MISSING', 'S3 未返回 ETag');
    }
    etags.set(n, etag);
    loaded = end;
    input.onProgress?.(loaded, input.size);
  }

  const parts: Array<{ partNumber: number; etag: string }> = [];
  for (let n = 1; n <= init.totalParts; n += 1) {
    const etag = etags.get(n);
    if (etag === undefined) {
      throw new ApiError(0, 'UPLOAD_ETAG_MISSING', `分片 ${String(n)} 缺少 ETag`);
    }
    parts.push({ partNumber: n, etag });
  }
  return http.request<UploadCompleteResponse>(`/api/v1/uploads/${init.id}/complete`, {
    method: 'POST',
    body: { parts },
  });
}
