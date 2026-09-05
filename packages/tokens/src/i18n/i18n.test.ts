import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';

function leafKeys(value: unknown, prefix = ''): string[] {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leafKeys(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

describe('i18n', () => {
  it('en and zh-CN key sets are equal', () => {
    expect(leafKeys(en)).toEqual(leafKeys(zhCN));
  });
});
