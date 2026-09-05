import type { AuthTokens } from '@vital/dto';
import type { TokenStore } from './types.js';

export function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function respond(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(jsonResponse(status, body));
}

export function respond204(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 204 }));
}

export function bodyOf(init: RequestInit | undefined): unknown {
  if (init?.body === undefined || typeof init.body !== 'string') return undefined;
  return JSON.parse(init.body) as unknown;
}

export function authorizationOf(init: RequestInit | undefined): string {
  const headers = init?.headers;
  if (headers instanceof Headers) return headers.get('Authorization') ?? '';
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      const name = pair[0];
      const value = pair[1];
      if (name === 'Authorization') return value;
    }
    return '';
  }
  if (headers === undefined) return '';
  return headers.Authorization ?? '';
}

export function memoryStore(tokens?: AuthTokens): TokenStore & {
  tokens: AuthTokens | null;
  cleared: boolean;
} {
  const store = {
    tokens: tokens ?? null,
    cleared: false,
    getAccessToken() {
      return store.tokens?.accessToken ?? null;
    },
    getRefreshToken() {
      return store.tokens?.refreshToken ?? null;
    },
    setTokens(t: AuthTokens) {
      store.tokens = t;
      store.cleared = false;
    },
    clear() {
      store.tokens = null;
      store.cleared = true;
    },
  };
  return store;
}
