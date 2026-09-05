import type { AuthMode, AuthTokens } from '@vital/dto';

/**
 * Token persistence. Cookie web stores access in memory (`getRefreshToken` is
 * null — the refresh token lives in an httpOnly cookie). Bearer clients store
 * both (SecureStore / plugin-store / chrome.storage). App `clear()` may
 * dispatch `vital:auth-cleared`; this package only calls the method.
 */
export interface TokenStore {
  getAccessToken(): Promise<string | null> | string | null;
  /** Cookie mode may always return null; Http must still cookie-refresh. */
  getRefreshToken(): Promise<string | null> | string | null;
  setTokens(tokens: AuthTokens): Promise<void> | void;
  clear(): Promise<void> | void;
}

/** `{ error: { code, message, details? } }` client shape. Matches server AppError field order. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/** RN/file-uri put: interval on disk so the whole file is not read into memory. */
export interface FilePart {
  fileUri: string;
  start: number;
  end: number;
  size: number;
  mime: string;
}

/** Presigned PUT with progress. Default is browser XHR (Blob only). */
export type PutFn = (
  url: string,
  body: Blob | FilePart,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
) => Promise<{ etag: string | null }>;

export interface VitalClientOptions {
  /** API root, e.g. `''` (web same-origin) or `http://127.0.0.1:3010` (Tauri). */
  baseUrl: string;
  tokenStore: TokenStore;
  /** Chosen at runtime: cookie for browser web, bearer for Tauri/extension/mobile. */
  authMode: AuthMode;
  fetchImpl?: typeof fetch;
  putWithProgress?: PutFn;
}
