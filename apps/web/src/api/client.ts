import { createVitalClient, type TokenStore, type VitalClient } from '@vital/api-client';
import type { AuthTokens } from '@vital/dto';

const AUTH_CLEARED = 'vital:auth-cleared';
const TAURI_AUTH_STORE = 'vital-auth.json';
const ACCESS_KEY = 'accessToken';
const REFRESH_KEY = 'refreshToken';

export const AUTH_CLEARED_EVENT = AUTH_CLEARED;
export const TAURI_DEV_API_URL = 'http://127.0.0.1:3010';

export type TauriEnv = {
  DEV: boolean;
  VITE_TAURI_API_URL?: string;
};

/** plugin-store surface used by the bearer TokenStore (injected in tests). */
export type TauriKv = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
  save(): Promise<void>;
};

export function isTauriRuntime(
  target: { __TAURI_INTERNALS__?: unknown } | null | undefined = globalThis.window,
): boolean {
  return target != null && target.__TAURI_INTERNALS__ !== undefined;
}

/** plugin-http has no webview origin — baseUrl must be absolute. */
export function tauriBaseUrl(env: TauriEnv = import.meta.env): string {
  if (env.DEV) {
    return TAURI_DEV_API_URL;
  }
  const url = env.VITE_TAURI_API_URL;
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('VITE_TAURI_API_URL is required for the Tauri production build');
  }
  return url.replace(/\/$/, '');
}

function defaultTauriKv(): TauriKv {
  let loaded: Promise<TauriKv> | undefined;
  const load = (): Promise<TauriKv> => {
    loaded ??= import('@tauri-apps/plugin-store').then(
      (mod) => new mod.LazyStore(TAURI_AUTH_STORE) as TauriKv,
    );
    return loaded;
  };
  return {
    get: async (key) => (await load()).get(key),
    set: async (key, value) => {
      await (await load()).set(key, value);
    },
    delete: async (key) => (await load()).delete(key),
    save: async () => {
      await (await load()).save();
    },
  };
}

let pluginHttp: Promise<typeof import('@tauri-apps/plugin-http')> | undefined;

function loadPluginHttp(): Promise<typeof import('@tauri-apps/plugin-http')> {
  pluginHttp ??= import('@tauri-apps/plugin-http');
  return pluginHttp;
}

/** Native fetch — never the webview `fetch` (CORS + Origin=WEB_ORIGIN). */
export const tauriFetch: typeof fetch = (input, init) =>
  loadPluginHttp().then((mod) => mod.fetch(input, init));

/** Memory-only access. Refresh lives in the httpOnly cookie; never persist tokens. */
export function createCookieTokenStore(): TokenStore {
  let accessToken: string | null = null;
  return {
    getAccessToken: () => accessToken,
    getRefreshToken: () => null,
    setTokens: (tokens: AuthTokens) => {
      accessToken = tokens.accessToken;
    },
    clear: () => {
      accessToken = null;
      window.dispatchEvent(new Event(AUTH_CLEARED));
    },
  };
}

export function createTauriTokenStore(kv: TauriKv = defaultTauriKv()): TokenStore {
  return {
    getAccessToken: async () => {
      const value = await kv.get(ACCESS_KEY);
      return typeof value === 'string' && value !== '' ? value : null;
    },
    getRefreshToken: async () => {
      const value = await kv.get(REFRESH_KEY);
      return typeof value === 'string' && value !== '' ? value : null;
    },
    setTokens: async (tokens: AuthTokens) => {
      await kv.set(ACCESS_KEY, tokens.accessToken);
      if (typeof tokens.refreshToken === 'string' && tokens.refreshToken !== '') {
        await kv.set(REFRESH_KEY, tokens.refreshToken);
      } else {
        await kv.delete(REFRESH_KEY);
      }
      await kv.save();
    },
    clear: async () => {
      await kv.delete(ACCESS_KEY);
      await kv.delete(REFRESH_KEY);
      await kv.save();
      window.dispatchEvent(new Event(AUTH_CLEARED));
    },
  };
}

export function createAppClient(input: {
  isTauri: boolean;
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
  env?: TauriEnv;
}): VitalClient {
  if (!input.isTauri) {
    return createVitalClient({
      baseUrl: '',
      authMode: 'cookie',
      tokenStore: input.tokenStore,
      fetchImpl: input.fetchImpl,
    });
  }
  return createVitalClient({
    baseUrl: tauriBaseUrl(input.env),
    authMode: 'bearer',
    tokenStore: input.tokenStore,
    fetchImpl: input.fetchImpl ?? tauriFetch,
  });
}

const isTauri = isTauriRuntime();

export const tokenStore: TokenStore = isTauri ? createTauriTokenStore() : createCookieTokenStore();

export const client = createAppClient({ isTauri, tokenStore });
