import type { AuthMode, AuthResponse, AuthTokens, ErrorEnvelope } from '@vital/dto';
import { ApiError, type TokenStore, type VitalClientOptions } from './types.js';

export { ApiError };
export type { TokenStore, VitalClientOptions };

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** true = do not attach Authorization (login/register/refresh/logout). */
  skipAuth?: boolean;
  /** true = 401 does not trigger refresh (auth endpoints; prevents loops). */
  skipAuthRefresh?: boolean;
  signal?: AbortSignal;
  /** Override; `requestBlob` forces `omit` so a followed S3 302 never gets cookies. */
  credentials?: RequestCredentials;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

function isAuthTokens(value: unknown): value is AuthTokens {
  if (!isRecord(value)) return false;
  if (typeof value.accessToken !== 'string' || typeof value.expiresIn !== 'number') return false;
  return value.refreshToken === undefined || typeof value.refreshToken === 'string';
}

export function isAuthResponse(value: unknown): value is AuthResponse {
  return isRecord(value) && isAuthTokens(value.tokens) && isRecord(value.user);
}

/** Cookie TokenStore is memory-only access; never persist a refresh-token string. */
export function tokensForStore(authMode: AuthMode, tokens: AuthTokens): AuthTokens {
  if (authMode === 'cookie') {
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }
  return tokens;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = `${baseUrl}${path}`;
  if (query === undefined) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs === '' ? url : `${url}?${qs}`;
}

function decodeJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = `HTTP_${String(res.status)}`;
  let message = `请求失败（${String(res.status)}）`;
  let details: unknown;
  try {
    const text = await res.text();
    if (text !== '') {
      const raw = decodeJson(text);
      if (isErrorEnvelope(raw)) {
        code = raw.error.code;
        message = raw.error.message;
        if (raw.error.details !== undefined) {
          details = raw.error.details;
        }
      }
    }
  } catch {
    // Non-JSON error body: keep HTTP_xxx.
  }
  if (details !== undefined) {
    return new ApiError(res.status, code, message, details);
  }
  return new ApiError(res.status, code, message);
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (text === '') {
    return undefined as T;
  }
  return decodeJson(text) as T;
}

async function settle(result: Promise<void> | void): Promise<void> {
  try {
    await result;
  } catch {
    // TokenStore failures must not mask ApiError.
  }
}

function wrapNetwork(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : '网络错误');
}

/** Low-level HTTP: cookie vs bearer, single-flight 401 refresh, replay once. */
export class Http {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly authMode: AuthMode;
  private refreshPromise: Promise<AuthResponse> | null = null;

  constructor(options: VitalClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.tokenStore = options.tokenStore;
    this.authMode = options.authMode;
    // bind: window.fetch as a method loses `this` (Illegal invocation).
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  /**
   * Cookie web after reload: access is memory-only, `vital_rt` remains.
   * Tries refresh once; false means treat the user as logged out.
   */
  async boot(): Promise<boolean> {
    const existing = await this.tokenStore.getAccessToken();
    if (existing !== null && existing !== '') {
      return true;
    }
    if (this.authMode !== 'cookie') {
      return false;
    }
    try {
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const first = await this.doFetch(path, options);
    if (first.status === 401 && (await this.shouldAttemptRefresh(options))) {
      const refreshed = await this.refresh();
      const second = await this.doFetch(path, options, refreshed.tokens.accessToken);
      if (!second.ok) {
        if (second.status === 401) {
          await settle(this.tokenStore.clear());
        }
        throw await toApiError(second);
      }
      return parseBody<T>(second);
    }
    if (!first.ok) throw await toApiError(first);
    return parseBody<T>(first);
  }

  /**
   * GET /uploads/:id → 302 S3. Always `credentials: 'omit'` (default follow).
   * API hop is Bearer only; the cross-origin S3 hop then has no cookies and
   * browsers strip Authorization. Do not use `redirect: 'manual'` (opaque).
   */
  async requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
    const blobOpts: RequestOptions = { ...options, credentials: 'omit' };
    const first = await this.doFetch(path, blobOpts);
    if (first.status === 401 && (await this.shouldAttemptRefresh(options))) {
      const refreshed = await this.refresh();
      const second = await this.doFetch(path, blobOpts, refreshed.tokens.accessToken);
      if (!second.ok) {
        if (second.status === 401) {
          await settle(this.tokenStore.clear());
        }
        throw await toApiError(second);
      }
      return second.blob();
    }
    if (!first.ok) throw await toApiError(first);
    return first.blob();
  }

  /** Single-flight: concurrent 401s share one refresh. Failure clears the store. */
  refresh(): Promise<AuthResponse> {
    if (this.refreshPromise === null) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async shouldAttemptRefresh(options: RequestOptions): Promise<boolean> {
    if (options.skipAuth === true || options.skipAuthRefresh === true) {
      return false;
    }
    // Cookie: no refresh-token string — still POST {} with credentials.
    if (this.authMode === 'cookie') {
      return true;
    }
    const refreshToken = await this.tokenStore.getRefreshToken();
    return refreshToken !== null && refreshToken !== '';
  }

  private async doFetch(
    path: string,
    options: RequestOptions,
    tokenOverride?: string,
  ): Promise<Response> {
    let token: string | undefined = tokenOverride;
    if (token === undefined && options.skipAuth !== true) {
      const stored = await this.tokenStore.getAccessToken();
      if (stored !== null && stored !== '') {
        token = stored;
      }
    }
    const headers: Record<string, string> = {};
    if (token !== undefined) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      credentials: options.credentials ?? (this.authMode === 'cookie' ? 'include' : 'omit'),
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    if (options.signal !== undefined) {
      init.signal = options.signal;
    }
    try {
      return await this.fetchImpl(buildUrl(this.baseUrl, path, options.query), init);
    } catch (err) {
      throw wrapNetwork(err);
    }
  }

  private async doRefresh(): Promise<AuthResponse> {
    const refreshOpts: RequestOptions = {
      method: 'POST',
      skipAuth: true,
      skipAuthRefresh: true,
    };
    if (this.authMode === 'cookie') {
      refreshOpts.body = {};
    } else {
      const refreshToken = await this.tokenStore.getRefreshToken();
      if (refreshToken === null || refreshToken === '') {
        await settle(this.tokenStore.clear());
        throw new ApiError(401, 'INVALID_TOKEN', '登录已过期');
      }
      refreshOpts.body = { refreshToken };
    }
    const res = await this.doFetch('/api/v1/auth/refresh', refreshOpts);
    if (!res.ok) {
      await settle(this.tokenStore.clear());
      throw await toApiError(res);
    }
    const data = await parseBody<unknown>(res);
    if (!isAuthResponse(data)) {
      await settle(this.tokenStore.clear());
      throw new ApiError(0, 'INVALID_RESPONSE', '响应格式错误');
    }
    const tokens = tokensForStore(this.authMode, data.tokens);
    await this.tokenStore.setTokens(tokens);
    return { user: data.user, tokens };
  }
}
