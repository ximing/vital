import assert from 'node:assert/strict';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

const appearance = vi.hoisted(() => ({
  setColorScheme: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => store.getItemAsync(...args),
  setItemAsync: (...args: unknown[]) => store.setItemAsync(...args),
}));

vi.mock('react-native', () => ({
  Appearance: {
    setColorScheme: (...args: unknown[]) => appearance.setColorScheme(...args),
  },
}));

import {
  THEME_CHOICE_OPTIONS,
  applyThemeChoice,
  colorSchemeOverride,
  getThemeChoice,
  hydrateThemeChoice,
  parseThemeChoice,
  resolveThemeScheme,
  setThemeChoice,
  subscribeThemeChoice,
} from './preference';

describe('parseThemeChoice', () => {
  it('只接受三档，其余回落 system', () => {
    assert.equal(parseThemeChoice('light'), 'light');
    assert.equal(parseThemeChoice('dark'), 'dark');
    assert.equal(parseThemeChoice('system'), 'system');
    assert.equal(parseThemeChoice(null), 'system');
    assert.equal(parseThemeChoice(''), 'system');
    assert.equal(parseThemeChoice('auto'), 'system');
  });
});

describe('resolveThemeScheme / colorSchemeOverride', () => {
  it('light/dark 无视系统；system 跟随，空系统按浅', () => {
    assert.equal(resolveThemeScheme('light', 'dark'), 'light');
    assert.equal(resolveThemeScheme('dark', 'light'), 'dark');
    assert.equal(resolveThemeScheme('system', 'dark'), 'dark');
    assert.equal(resolveThemeScheme('system', 'light'), 'light');
    assert.equal(resolveThemeScheme('system', null), 'light');
    assert.equal(resolveThemeScheme('system', undefined), 'light');
  });

  it('Appearance 覆盖：system 传 null，其余传自身', () => {
    assert.equal(colorSchemeOverride('system'), null);
    assert.equal(colorSchemeOverride('light'), 'light');
    assert.equal(colorSchemeOverride('dark'), 'dark');
  });
});

describe('THEME_CHOICE_OPTIONS', () => {
  it('三档文案中文', () => {
    assert.deepEqual(
      THEME_CHOICE_OPTIONS.map((o) => [o.value, o.label]),
      [
        ['system', '跟随系统'],
        ['light', '浅'],
        ['dark', '深'],
      ],
    );
  });
});

describe('setThemeChoice / hydrateThemeChoice', () => {
  beforeEach(() => {
    store.getItemAsync.mockReset();
    store.setItemAsync.mockReset();
    store.getItemAsync.mockResolvedValue(null);
    store.setItemAsync.mockResolvedValue(undefined);
    appearance.setColorScheme.mockReset();
    applyThemeChoice('system');
    appearance.setColorScheme.mockClear();
  });

  it('setThemeChoice 同步覆盖 Appearance 并写入 SecureStore', () => {
    setThemeChoice('dark');
    assert.equal(getThemeChoice(), 'dark');
    expect(appearance.setColorScheme).toHaveBeenCalledWith('dark');
    expect(store.setItemAsync).toHaveBeenCalledWith('vital.theme.choice', 'dark');
  });

  it('subscribeThemeChoice 在切换时收到新档', () => {
    const seen: string[] = [];
    const off = subscribeThemeChoice((c) => seen.push(c));
    setThemeChoice('light');
    off();
    setThemeChoice('dark');
    assert.deepEqual(seen, ['light']);
  });

  it('hydrate 读到 dark 后覆盖；损坏值回落 system', async () => {
    store.getItemAsync.mockResolvedValueOnce('dark');
    await hydrateThemeChoice();
    assert.equal(getThemeChoice(), 'dark');
    expect(appearance.setColorScheme).toHaveBeenCalledWith('dark');

    store.getItemAsync.mockResolvedValueOnce('nope');
    await hydrateThemeChoice();
    assert.equal(getThemeChoice(), 'system');
    expect(appearance.setColorScheme).toHaveBeenCalledWith(null);
  });
});
