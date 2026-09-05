import { File } from 'expo-file-system';
import { ApiError, xhrPut, type FilePart, type PutFn } from '@vital/api-client';

function isBlob(body: Blob | FilePart): body is Blob {
  return typeof Blob !== 'undefined' && body instanceof Blob;
}

function readPartBytes(part: FilePart): Uint8Array {
  const handle = new File(part.fileUri).open();
  try {
    handle.offset = part.start;
    return handle.readBytes(part.end - part.start);
  } finally {
    handle.close();
  }
}

/** RN PUT: Blob via XHR; FilePart reads [start, end) from disk so the whole file stays off-heap. */
export const rnPut: PutFn = (url, body, contentType, onProgress, signal) => {
  if (isBlob(body)) {
    return xhrPut(url, body, contentType, onProgress, signal);
  }
  try {
    const bytes = readPartBytes(body);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: contentType });
    return xhrPut(url, blob, contentType, onProgress, signal);
  } catch (err) {
    if (err instanceof ApiError) return Promise.reject(err);
    return Promise.reject(new ApiError(0, 'UPLOAD_FAILED', '分片读取失败'));
  }
};
