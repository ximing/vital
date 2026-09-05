import type { AuthTokens } from '@vital/dto';
import type { TokenStore } from '@vital/api-client';

/** Access lives in session (cleared when the browser closes); refresh in local. */
const ACCESS_KEY = 'vital.auth.access';
const REFRESH_KEY = 'vital.auth.refresh';
const PROFILE_KEY = 'vital.auth.profile';

export const chromeTokenStore: TokenStore = {
  async getAccessToken() {
    const stored = await chrome.storage.session.get(ACCESS_KEY);
    const value = stored[ACCESS_KEY];
    return typeof value === 'string' && value !== '' ? value : null;
  },
  async getRefreshToken() {
    const stored = await chrome.storage.local.get(REFRESH_KEY);
    const value = stored[REFRESH_KEY];
    return typeof value === 'string' && value !== '' ? value : null;
  },
  async setTokens(tokens: AuthTokens) {
    await chrome.storage.session.set({ [ACCESS_KEY]: tokens.accessToken });
    if (tokens.refreshToken !== undefined && tokens.refreshToken !== '') {
      await chrome.storage.local.set({ [REFRESH_KEY]: tokens.refreshToken });
    }
  },
  async clear() {
    await chrome.storage.session.remove([ACCESS_KEY, PROFILE_KEY]);
    await chrome.storage.local.remove(REFRESH_KEY);
  },
};

export async function storeProfileJson(json: string): Promise<void> {
  await chrome.storage.session.set({ [PROFILE_KEY]: json });
}

export async function readProfileJson(): Promise<string | null> {
  const stored = await chrome.storage.session.get(PROFILE_KEY);
  const value = stored[PROFILE_KEY];
  return typeof value === 'string' && value !== '' ? value : null;
}
