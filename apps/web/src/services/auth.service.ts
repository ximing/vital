import { resolve, Service, useObserverService } from '@rabjs/react';
import { isSessionInvalidError } from '@vital/api-client';
import type { LoginInput, RegisterInput, UserProfile } from '@vital/dto';
import { AUTH_CLEARED_EVENT, client } from '@/api/client';
import { ThemeService } from '@/services/theme.service';

export type AuthStatus = 'booting' | 'ready' | 'unavailable';

export class AuthService extends Service {
  status: AuthStatus = 'booting';
  user: UserProfile | null = null;
  private listening = false;

  get themeService(): ThemeService {
    return this.resolve(ThemeService);
  }

  constructor() {
    super();
    if (typeof window !== 'undefined' && !this.listening) {
      this.listening = true;
      window.addEventListener(AUTH_CLEARED_EVENT, () => {
        this.user = null;
        this.status = 'ready';
      });
    }
  }

  setUser(user: UserProfile | null): void {
    this.user = user;
  }

  async boot(): Promise<void> {
    const result = await client.boot();
    if (result === 'guest') {
      this.user = null;
      this.status = 'ready';
      return;
    }
    if (result === 'unreachable') {
      this.status = 'unavailable';
      return;
    }
    try {
      const user = await client.me();
      this.themeService.setChoice(user.themePreference);
      this.user = user;
      this.status = 'ready';
    } catch (err) {
      if (isSessionInvalidError(err)) {
        this.user = null;
        this.status = 'ready';
        return;
      }
      this.status = 'unavailable';
    }
  }

  async retryBoot(): Promise<void> {
    this.status = 'booting';
    await this.boot();
  }

  async login(input: LoginInput): Promise<void> {
    const res = await client.login(input);
    this.themeService.setChoice(res.user.themePreference);
    this.user = res.user;
    this.status = 'ready';
  }

  async register(input: RegisterInput): Promise<void> {
    const res = await client.register(input);
    this.themeService.setChoice(res.user.themePreference);
    this.user = res.user;
    this.status = 'ready';
  }

  async logout(): Promise<void> {
    try {
      await client.logout();
    } finally {
      this.user = null;
      this.status = 'ready';
    }
  }

  reset(user: UserProfile | null = null, status: AuthStatus = 'ready'): void {
    this.user = user;
    this.status = status;
  }
}

export function authService(): AuthService {
  return resolve(AuthService);
}

export function useAuth<T>(selector: (s: AuthService) => T): T {
  const [value] = useObserverService(AuthService, selector);
  return value;
}

export function setAuthForTest(user: UserProfile | null, status: AuthStatus = 'ready'): void {
  authService().reset(user, status);
}
