import { describe, expect, it } from 'vitest';
import { decodeEntities } from '../../src/lib/html';

describe('decodeEntities', () => {
  it('decodes hexadecimal numeric references', () => {
    expect(decodeEntities('买菜&#x20;清单')).toBe('买菜 清单');
  });

  it('decodes decimal numeric references', () => {
    expect(decodeEntities('a&#32;b&#39;c')).toBe("a b'c");
  });

  it('decodes a mix of named and numeric references', () => {
    expect(decodeEntities('A&amp;B&#x20;&lt;x&gt;')).toBe('A&B <x>');
    expect(decodeEntities('foo &mdash; bar &hellip;')).toBe('foo — bar …');
  });

  it('leaves invalid or out-of-range references untouched', () => {
    expect(decodeEntities('&#x110000; &#0; &unknown;')).toBe('&#x110000; &#0; &unknown;');
  });
});


