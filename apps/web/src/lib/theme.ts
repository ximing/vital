import { themes } from '@vital/tokens';
import { getVitalHost } from '@/host';

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

function syncNativeWindowChrome(scheme: 'light' | 'dark'): void {
  const host = getVitalHost();
  if (!host) return;
  host.applyChrome({ scheme, background: themes[scheme].bgCanvas });
}

/** Runtime twin of the index.html FOUC snippet. Also syncs the native titlebar in the desktop shell. */
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
