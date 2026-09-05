import {
  ERROR_MESSAGES,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  type UploadCompleteResponse,
  type UploadPresignResponse,
} from '@vital/dto';
import type { Http } from './http.js';
import { xhrPut } from './default-put.js';
import { ApiError, type FilePart, type PutFn, type VitalClientOptions } from './types.js';

export interface UploadInput {
  file?: Blob;
  fileUri?: string;
  mime: string;
  size: number;
  onProgress?: (loaded: number, total: number) => void;
  /** Fired after presign succeeds and before the first PUT (caller can abort/discard). */
  onAttachmentId?: (id: string) => void;
  signal?: AbortSignal;
}

export async function uploadImpl(
  http: Http,
  options: VitalClientOptions,
  input: UploadInput,
): Promise<UploadCompleteResponse> {
  if (input.size > MAX_IMAGE_BYTES) {
    throw new ApiError(413, 'MEDIA_TOO_LARGE', ERROR_MESSAGES.MEDIA_TOO_LARGE);
  }
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(input.mime)) {
    throw new ApiError(422, 'MEDIA_MISMATCH', ERROR_MESSAGES.MEDIA_MISMATCH);
  }

  const file = input.file;
  const fileUri = input.fileUri;
  let body: Blob | FilePart;
  if (file !== undefined) {
    body = file;
  } else if (fileUri !== undefined) {
    body = { fileUri, start: 0, end: input.size, size: input.size, mime: input.mime };
  } else {
    throw new ApiError(0, 'UPLOAD_INPUT_INVALID', 'file 与 fileUri 必须提供其一');
  }

  const put: PutFn = options.putWithProgress ?? xhrPut;
  const presigned = await http.request<UploadPresignResponse>('/api/v1/uploads/presign', {
    method: 'POST',
    body: { mime: input.mime, size: input.size },
  });
  input.onAttachmentId?.(presigned.id);

  await put(presigned.url, body, input.mime, input.onProgress, input.signal);
  return http.request<UploadCompleteResponse>(`/api/v1/uploads/${presigned.id}/complete`, {
    method: 'POST',
    body: {},
  });
}
