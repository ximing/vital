import { resolve, Service, useObserverService } from '@rabjs/react';
import type { LoginInput, RegisterInput, UserProfile } from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { client } from '../lib/api';
import { startMobileSync, stopMobileSync } from '../lib/sync';
import { loadUser, onAuthCleared, saveUser, secureTokenStore } from '../lib/token-store';

export class AuthService extends Service {
  ready = false;
  user: UserProfile | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    onAuthCleared(() => {
      stopMobileSync();
      this.user = null;
      this.ready = true;
    });
    void this.boot();
  }

  async boot(): Promise<void> {
    const stored = await loadUser();
    this.user = stored;
    this.ready = true;
    if (!stored) return;
    startMobileSync();
    try {
      const me = await client.me();
      await saveUser(me);
      this.user = me;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        stopMobileSync();
        await secureTokenStore.clear();
      }
    }
  }

  async login(input: LoginInput): Promise<UserProfile> {
    const res = await client.login(input);
    await saveUser(res.user);
    this.user = res.user;
    startMobileSync();
    return res.user;
  }

  async register(input: RegisterInput): Promise<UserProfile> {
    const res = await client.register(input);
    await saveUser(res.user);
    this.user = res.user;
    startMobileSync();
    return res.user;
  }

  async logout(): Promise<void> {
    stopMobileSync();
    await client.logout().catch(() => undefined);
    await secureTokenStore.clear();
    this.user = null;
  }

  refreshUser(next: UserProfile): void {
    void saveUser(next);
    this.user = next;
  }
}

export function authService(): AuthService {
  return resolve(AuthService);
}

export function useAuth(): AuthService {
  const [, service] = useObserverService(AuthService, (s) => [s.ready, s.user]);
  return service;
}
