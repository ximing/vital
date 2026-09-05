import { ApiError, type FilePart, type PutFn } from './types.js';

function isBlob(body: Blob | FilePart): body is Blob {
  return typeof Blob !== 'undefined' && body instanceof Blob;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** PUT init for a presigned S3 URL: Content-Type only — never cookies or Authorization. */
export function barePutInit(body: Blob, contentType: string, signal?: AbortSignal): RequestInit {
  const init: RequestInit = {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
    credentials: 'omit',
  };
  if (signal !== undefined) {
    init.signal = signal;
  }
  return init;
}

/**
 * Browser default PUT. XHR (fetch has no upload progress).
 * `withCredentials` stays false so the cookie is not sent to S3.
 */
export const xhrPut: PutFn = (url, body, contentType, onProgress, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new ApiError(0, 'ABORTED', '已取消'));
      return;
    }
    if (typeof XMLHttpRequest === 'undefined') {
      reject(
        new ApiError(0, 'PUT_UNAVAILABLE', '当前环境无 XMLHttpRequest，请注入 putWithProgress'),
      );
      return;
    }
    if (!isBlob(body)) {
      reject(new ApiError(0, 'PUT_UNAVAILABLE', 'fileUri 形态需注入自定义 putWithProgress'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      onProgress?.(e.loaded, e.total);
    };
    const onAbort = () => {
      xhr.abort();
    };
    signal?.addEventListener('abort', onAbort);
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag') });
      } else {
        reject(new ApiError(xhr.status, 'UPLOAD_FAILED', `直传失败（${String(xhr.status)}）`));
      }
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new ApiError(0, 'NETWORK_ERROR', '网络错误'));
    };
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new ApiError(0, 'ABORTED', '已取消'));
    };
    xhr.send(body);
  });

/** fetch PUT for node/tests/Tauri plugin-http. Still no cookies, no Authorization. */
export const fetchPut: PutFn = async (url, body, contentType, onProgress, signal) => {
  if (signal?.aborted === true) {
    throw new ApiError(0, 'ABORTED', '已取消');
  }
  if (!isBlob(body)) {
    throw new ApiError(0, 'PUT_UNAVAILABLE', 'fileUri 形态需注入自定义 putWithProgress');
  }
  onProgress?.(0, body.size);
  try {
    const res = await fetch(url, barePutInit(body, contentType, signal));
    if (!res.ok) {
      throw new ApiError(res.status, 'UPLOAD_FAILED', `直传失败（${String(res.status)}）`);
    }
    onProgress?.(body.size, body.size);
    return { etag: res.headers.get('ETag') };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (isAbortError(err)) throw new ApiError(0, 'ABORTED', '已取消');
    throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : '网络错误');
  }
};
