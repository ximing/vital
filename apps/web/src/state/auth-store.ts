import type { LoginInput, RegisterInput, UserProfile } from '@vital/dto';
import { create } from 'zustand';
import { AUTH_CLEARED_EVENT, client } from '@/api/client';
import { useThemeStore } from '@/state/theme-store';

export type AuthStatus = 'booting' | 'ready';

type AuthState = {
  status: AuthStatus;
  user: UserProfile | null;
  boot: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: UserProfile | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: 'booting',
  user: null,
  setUser: (user) => set({ user }),
  boot: async () => {
    const ok = await client.boot();
    if (!ok) {
      set({ status: 'ready', user: null });
      return;
    }
    try {
      const user = await client.me();
      useThemeStore.getState().setChoice(user.themePreference);
      set({ status: 'ready', user });
    } catch {
      set({ status: 'ready', user: null });
    }
  },
  login: async (input) => {
    const res = await client.login(input);
    useThemeStore.getState().setChoice(res.user.themePreference);
    set({ user: res.user, status: 'ready' });
  },
  register: async (input) => {
    const res = await client.register(input);
    useThemeStore.getState().setChoice(res.user.themePreference);
    set({ user: res.user, status: 'ready' });
  },
  logout: async () => {
    try {
      await client.logout();
    } finally {
      set({ user: null, status: 'ready' });
    }
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_CLEARED_EVENT, () => {
    useAuthStore.setState({ user: null, status: 'ready' });
  });
}
