import { ApiError, createVitalClient, fetchPut, type VitalClient } from '@vital/api-client';
import type { UserProfile } from '@vital/dto';
import { API_URL, WEB_URL } from './config.js';
import { copy } from './i18n.js';
import type { PanelRequest, PanelResponse } from './messages.js';
import { chromeTokenStore, readProfileJson, storeProfileJson } from './token-store.js';

let client: VitalClient | null = null;

export function getClient(): VitalClient {
  if (client === null) {
    client = createVitalClient({
      baseUrl: API_URL,
      authMode: 'bearer',
      tokenStore: chromeTokenStore,
      fetchImpl: fetch.bind(globalThis),
      // Service workers have no XMLHttpRequest.
      putWithProgress: fetchPut,
    });
  }
  return client;
}

function isProfile(value: unknown): value is UserProfile {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    typeof rec.email === 'string' &&
    typeof rec.displayName === 'string'
  );
}

async function cachedProfile(): Promise<UserProfile | null> {
  const raw = await readProfileJson();
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function persistProfile(user: UserProfile): Promise<void> {
  await storeProfileJson(JSON.stringify(user));
}

export async function getSession(): Promise<
  { loggedIn: false } | { loggedIn: true; profile: UserProfile }
> {
  const cached = await cachedProfile();
  const access = await chromeTokenStore.getAccessToken();
  if (cached !== null && access !== null) {
    return { loggedIn: true, profile: cached };
  }
  const refresh = await chromeTokenStore.getRefreshToken();
  if (refresh === null && access === null) {
    return { loggedIn: false };
  }
  try {
    const user = await getClient().me();
    await persistProfile(user);
    return { loggedIn: true, profile: user };
  } catch {
    return { loggedIn: false };
  }
}

export async function requireAuth(): Promise<boolean> {
  const session = await getSession();
  return session.loggedIn;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message !== '') return err.message;
  return copy.toastFailed;
}

export async function handlePanelMessage(message: PanelRequest): Promise<PanelResponse> {
  switch (message.type) {
    case 'session': {
      return { ok: true, session: await getSession() };
    }
    case 'login': {
      try {
        const res = await getClient().login({ email: message.email, password: message.password });
        await persistProfile(res.user);
        return { ok: true, session: { loggedIn: true, profile: res.user } };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }
    case 'logout': {
      try {
        await getClient().logout();
      } catch {
        await chromeTokenStore.clear();
      }
      return { ok: true, session: { loggedIn: false } };
    }
    case 'recent': {
      try {
        const collection = await getClient().listInbox({ limit: 5 });
        return { ok: true, items: collection.items };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }
    case 'open-web': {
      await chrome.tabs.create({ url: `${WEB_URL.replace(/\/$/, '')}/inbox` });
      return { ok: true };
    }
  }
}

export { errorMessage };
