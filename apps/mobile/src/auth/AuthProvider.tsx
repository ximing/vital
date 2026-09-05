import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LoginInput, RegisterInput, UserProfile } from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { client } from '../lib/api';
import { loadUser, onAuthCleared, saveUser, secureTokenStore } from '../lib/token-store';

type AuthContextValue = {
  ready: boolean;
  user: UserProfile | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: (next: UserProfile) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    return onAuthCleared(() => {
      setUser(null);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadUser();
      if (cancelled) return;
      setUser(stored);
      setReady(true);
      if (!stored) return;
      try {
        const me = await client.me();
        if (cancelled) return;
        await saveUser(me);
        setUser(me);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          await secureTokenStore.clear();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyUser = useCallback(async (next: UserProfile) => {
    await saveUser(next);
    setUser(next);
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      const res = await client.login(input);
      await applyUser(res.user);
    },
    [applyUser],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await client.register(input);
      await applyUser(res.user);
    },
    [applyUser],
  );

  const logout = useCallback(async () => {
    await client.logout().catch(() => undefined);
    await secureTokenStore.clear();
  }, []);

  const refreshUser = useCallback((next: UserProfile) => {
    void saveUser(next);
    setUser(next);
  }, []);

  const value = useMemo(
    () => ({ ready, user, login, register, logout, refreshUser }),
    [ready, user, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
