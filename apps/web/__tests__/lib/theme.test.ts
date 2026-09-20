import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { themes } from '@vital/tokens';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getThemeChoice,
  resolveTheme,
  setNativeWindowChromeForTest,
  setThemeChoice,
  subscribeSystemTheme,
} from '../../src/lib/theme';

function mockMatchMedia(dark: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: dark && query.includes('prefers-color-scheme: dark'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

describe('theme helper', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockMatchMedia(false);
  });

  afterEach(() => {
    localStorage.clear();
    setNativeWindowChromeForTest(null);
  });

  it('defaults to system when storage is empty', () => {
    expect(getThemeChoice()).toBe('system');
  });

  it('reads light and dark from vital:theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getThemeChoice()).toBe('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(getThemeChoice()).toBe('light');
    localStorage.setItem(THEME_STORAGE_KEY, 'nope');
    expect(getThemeChoice()).toBe('system');
  });

  it('resolveTheme follows the system when choice is system', () => {
    mockMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
    mockMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('applyTheme writes data-theme on the document element', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('setThemeChoice persists and applies', () => {
    setThemeChoice('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('syncs the native titlebar to the resolved scheme in Tauri', async () => {
    const setTheme = vi.fn(async () => undefined);
    const setBackgroundColor = vi.fn(async () => undefined);
    setNativeWindowChromeForTest(async () => ({ setTheme, setBackgroundColor }));

    setThemeChoice('light');
    await vi.waitFor(() => {
      expect(setTheme).toHaveBeenCalledWith('light');
      expect(setBackgroundColor).toHaveBeenCalledWith(themes.light.bgCanvas);
    });

    setThemeChoice('dark');
    await vi.waitFor(() => {
      expect(setTheme).toHaveBeenCalledWith('dark');
      expect(setBackgroundColor).toHaveBeenCalledWith(themes.dark.bgCanvas);
    });

    setTheme.mockClear();
    mockMatchMedia(true);
    setThemeChoice('system');
    await vi.waitFor(() => {
      expect(setTheme).toHaveBeenCalledWith('dark');
    });
  });

  it('subscribeSystemTheme registers and unregisters the media listener', () => {
    const add = vi.fn();
    const remove = vi.fn();
    window.matchMedia = () =>
      ({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: add,
        removeEventListener: remove,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList;
    const unsub = subscribeSystemTheme();
    expect(add).toHaveBeenCalledWith('change', expect.any(Function));
    unsub();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('survives localStorage throws', () => {
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getThemeChoice()).toBe('system');
    spy.mockRestore();
  });
});
