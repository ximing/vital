import { request } from 'undici';
import type { Dispatcher } from 'undici';

export type RetrievalErrorCode = 'TIMEOUT' | 'NETWORK' | 'HTTP_4XX' | 'HTTP_5XX' | 'BAD_RESPONSE';

/** Infra-level failure from an outbound retrieval call. Callers decide how to degrade. */
export class RetrievalError extends Error {
  readonly code: RetrievalErrorCode;
  readonly status: number | undefined;

  constructor(code: RetrievalErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'RetrievalError';
    this.code = code;
    this.status = status;
  }
}

export interface JsonResponse {
  status: number;
  /** Parsed JSON body, or null when the body is empty / not JSON. */
  json: unknown;
  text: string;
}

export interface RequestJsonOptions {
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number | undefined;
  /** Retry once on 5xx / network / timeout failures. Default true. */
  retry?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function isAbortLike(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

async function attemptOnce(
  method: string,
  url: string,
  opts: RequestJsonOptions,
): Promise<JsonResponse> {
  const init = {
    method: method as Dispatcher.HttpMethod,
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ...(opts.headers ? { headers: opts.headers } : {}),
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };
  let res: Dispatcher.ResponseData;
  try {
    res = await request(url, init);
  } catch (err) {
    if (isAbortLike(err)) {
      throw new RetrievalError('TIMEOUT', `request ${method} ${url} timed out`);
    }
    throw new RetrievalError('NETWORK', `request ${method} ${url} failed: ${String(err)}`);
  }
  const text = await res.body.text();
  let json: unknown = null;
  if (text !== '') {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return { status: res.statusCode, json, text };
}

/**
 * JSON-over-HTTP with a hard timeout. Does not throw on HTTP error statuses —
 * callers use ensure2xx (or inspect `status`, e.g. Qdrant/Meili 404 probing).
 * 5xx, network and timeout failures are retried once by default; 4xx never is.
 */
export async function requestJson(
  method: string,
  url: string,
  opts: RequestJsonOptions = {},
): Promise<JsonResponse> {
  const maxAttempts = (opts.retry ?? true) ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const res = await attemptOnce(method, url, opts);
      if (res.status >= 500 && attempt + 1 < maxAttempts) continue;
      return res;
    } catch (err) {
      lastError = err;
      if (attempt + 1 >= maxAttempts) throw err;
    }
  }
  throw lastError;
}

export function ensure2xx(res: JsonResponse, what: string): void {
  if (res.status >= 200 && res.status < 300) return;
  const code: RetrievalErrorCode = res.status >= 500 ? 'HTTP_5XX' : 'HTTP_4XX';
  throw new RetrievalError(code, `${what} failed with status ${String(res.status)}: ${res.text.slice(0, 200)}`, res.status);
}
