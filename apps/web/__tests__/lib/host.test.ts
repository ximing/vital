import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVitalHost, isDesktopHost, type VitalHost } from '../../src/host';

function desktopHost(overrides: Partial<VitalHost> = {}): VitalHost {
  return {
    kind: 'desktop',
    applyChrome() {},
    showStickyAlert() {},
    listenStickyAlerts: async () => () => undefined,
    closeStickyAlert() {},
    openInMain() {},
    ...overrides,
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, '__VITAL_HOST__');
});

describe('vital host', () => {
  it('treats a missing host as the browser', () => {
    expect(getVitalHost()).toBeNull();
    expect(isDesktopHost()).toBe(false);
    expect(isDesktopHost({})).toBe(false);
    expect(isDesktopHost(null)).toBe(false);
  });

  it('ignores a host whose kind is not desktop or whose methods are missing', () => {
    expect(isDesktopHost({ __VITAL_HOST__: { kind: 'browser' } })).toBe(false);
    expect(isDesktopHost({ __VITAL_HOST__: { kind: 'desktop' } })).toBe(false);
    expect(getVitalHost({ __VITAL_HOST__: { kind: 'desktop', applyChrome() {} } })).toBeNull();
  });

  it('reads a desktop host from the window', () => {
    const host = desktopHost({
      applyChrome: vi.fn(),
    });
    Object.defineProperty(window, '__VITAL_HOST__', { configurable: true, value: host });
    expect(getVitalHost()).toBe(host);
    expect(isDesktopHost()).toBe(true);
    getVitalHost()?.applyChrome({ scheme: 'dark', background: '#0F1210' });
    expect(host.applyChrome).toHaveBeenCalledWith({ scheme: 'dark', background: '#0F1210' });
  });
});
