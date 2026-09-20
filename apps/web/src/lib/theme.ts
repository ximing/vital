import { themes } from '@vital/tokens';

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'vital:theme';

export function getThemeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Private mode / blocked storage → treat as system.
  }
  return 'system';
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'light' || choice === 'dark') return choice;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

type NativeWindowChrome = {
  setTheme: (theme: 'light' | 'dark') => Promise<void>;
  setBackgroundColor: (color: string) => Promise<void>;
};

async function loadNativeWindowChrome(): Promise<NativeWindowChrome | null> {
  if (typeof window === 'undefined' || window.__TAURI_INTERNALS__ === undefined) return null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow();
  } catch {
    return null;
  }
}

let nativeWindowChrome: () => Promise<NativeWindowChrome | null> = loadNativeWindowChrome;
let chromeSync = 0;

export function setNativeWindowChromeForTest(
  loader: (() => Promise<NativeWindowChrome | null>) | null,
): void {
  nativeWindowChrome = loader ?? loadNativeWindowChrome;
  chromeSync = 0;
}

function syncNativeWindowChrome(scheme: 'light' | 'dark'): void {
  const generation = ++chromeSync;
  const backgroundColor = themes[scheme].bgCanvas;
  void nativeWindowChrome()
    .then((chrome) => {
      if (!chrome || generation !== chromeSync) return;
      return Promise.all([chrome.setTheme(scheme), chrome.setBackgroundColor(backgroundColor)]);
    })
    .catch(() => undefined);
}

/** Runtime twin of the index.html FOUC snippet. Also syncs the native titlebar in Tauri. */
export function applyTheme(): void {
  const scheme = resolveTheme(getThemeChoice());
  document.documentElement.dataset.theme = scheme;
  syncNativeWindowChrome(scheme);
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Session still updates data-theme even if persist fails.
  }
  applyTheme();
}

export function subscribeSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyTheme();
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
