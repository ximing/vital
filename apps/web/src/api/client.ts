import { createVitalClient, type TokenStore, type VitalClient } from '@vital/api-client';
import type { AuthTokens } from '@vital/dto';

const AUTH_CLEARED = 'vital:auth-cleared';

export const AUTH_CLEARED_EVENT = AUTH_CLEARED;

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

export function createAppClient(input: {
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
}): VitalClient {
  return createVitalClient({
    baseUrl: '',
    authMode: 'cookie',
    tokenStore: input.tokenStore,
    fetchImpl: input.fetchImpl,
  });
}

export const tokenStore: TokenStore = createCookieTokenStore();

export const client = createAppClient({ tokenStore });
