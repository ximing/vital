import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { themes } from '@vital/tokens';
import type { VitalHost } from '../../src/host';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getThemeChoice,
  resolveTheme,
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
    Reflect.deleteProperty(window, '__VITAL_HOST__');
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

  it('syncs the native titlebar through the desktop host', () => {
    const applyChrome = vi.fn();
    const host: VitalHost = {
      kind: 'desktop',
      applyChrome,
      showStickyAlert() {},
      listenStickyAlerts: async () => () => undefined,
      closeStickyAlert() {},
      openInMain() {},
    };
    Object.defineProperty(window, '__VITAL_HOST__', { configurable: true, value: host });

    setThemeChoice('light');
    expect(applyChrome).toHaveBeenCalledWith({
      scheme: 'light',
      background: themes.light.bgCanvas,
    });

    setThemeChoice('dark');
    expect(applyChrome).toHaveBeenCalledWith({
      scheme: 'dark',
      background: themes.dark.bgCanvas,
    });

    applyChrome.mockClear();
    mockMatchMedia(true);
    setThemeChoice('system');
    expect(applyChrome).toHaveBeenCalledWith({
      scheme: 'dark',
      background: themes.dark.bgCanvas,
    });
  });

  it('does not ask for chrome when there is no desktop host', () => {
    expect(() => setThemeChoice('light')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
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
