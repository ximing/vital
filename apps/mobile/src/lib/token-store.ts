import * as SecureStore from 'expo-secure-store';
import type { AuthTokens, UserProfile } from '@vital/dto';
import type { TokenStore } from '@vital/api-client';

const TOKENS_KEY = 'vital.auth.tokens';
const USER_KEY = 'vital.auth.user';

async function readTokens(): Promise<AuthTokens | null> {
  const raw = await SecureStore.getItemAsync(TOKENS_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

export const secureTokenStore: TokenStore = {
  async getAccessToken() {
    return (await readTokens())?.accessToken ?? null;
  },
  async getRefreshToken() {
    return (await readTokens())?.refreshToken ?? null;
  },
  async setTokens(tokens) {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKENS_KEY).catch(() => undefined);
    await SecureStore.deleteItemAsync(USER_KEY).catch(() => undefined);
    notifyAuthCleared();
  },
};

type AuthClearedListener = () => void;
const authClearedListeners = new Set<AuthClearedListener>();

export function onAuthCleared(fn: AuthClearedListener): () => void {
  authClearedListeners.add(fn);
  return () => {
    authClearedListeners.delete(fn);
  };
}

function notifyAuthCleared(): void {
  for (const fn of [...authClearedListeners]) fn();
}

export async function loadUser(): Promise<UserProfile | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export async function saveUser(user: UserProfile): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}
