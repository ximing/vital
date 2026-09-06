import { describe, expect, it } from 'vitest';
import { initialsOf, railNavClass } from '../../src/shell/rail-nav';

describe('rail-nav', () => {
  it('takes the first CJK character or Latin initials', () => {
    expect(initialsOf('测试')).toBe('测');
    expect(initialsOf('probe')).toBe('P');
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('')).toBe('?');
  });

  it('uses a square selected state without rounding', () => {
    expect(railNavClass(true)).toContain('rounded-md');
    expect(railNavClass(true)).toContain('bg-accent-subtle');
    expect(railNavClass(true)).toContain('before:bg-accent');
  });
});
