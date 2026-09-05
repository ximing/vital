import { createVitalClient, type TokenStore } from '@vital/api-client';
import type { AuthTokens } from '@vital/dto';

const AUTH_CLEARED = 'vital:auth-cleared';

let accessToken: string | null = null;

/** Memory-only access. Refresh lives in the httpOnly cookie; never persist tokens. */
export const tokenStore: TokenStore = {
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

export const AUTH_CLEARED_EVENT = AUTH_CLEARED;

export const client = createVitalClient({
  baseUrl: '',
  authMode: 'cookie',
  tokenStore,
});
