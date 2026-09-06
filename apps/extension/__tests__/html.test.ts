import { describe, expect, it } from 'vitest';
import { clip, escapeParagraph, isHttpUrl, parseDim } from '../src/html.js';

describe('clip', () => {
  it('trims, nulls empty, truncates', () => {
    expect(clip('  hi  ', 10)).toBe('hi');
    expect(clip('   ', 10)).toBeNull();
    expect(clip('abcdefghij', 4)).toBe('abcd');
  });
});

describe('escapeParagraph', () => {
  it('wraps escaped text in a paragraph', () => {
    expect(escapeParagraph('A & B <c> "q"')).toBe('<p>A &amp; B &lt;c&gt; &quot;q&quot;</p>');
  });
});

describe('isHttpUrl', () => {
  it('accepts http(s) only', () => {
    expect(isHttpUrl('https://example.com/a')).toBe(true);
    expect(isHttpUrl('chrome://extensions')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('parseDim', () => {
  it('parses integer dimensions', () => {
    expect(parseDim('1')).toBe(1);
    expect(parseDim('800px')).toBe(800);
    expect(parseDim('auto')).toBeNull();
  });
});
