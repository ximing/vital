import { describe, expect, it } from 'vitest';
import { titleIsPlaceholder } from '../../src/extract/title.js';

describe('titleIsPlaceholder', () => {
  const url = 'https://news.example.com/a';

  it('matches the pasted URL and the hostname', () => {
    expect(titleIsPlaceholder(url, url)).toBe(true);
    expect(titleIsPlaceholder('https://news.example.com/a/', url)).toBe(true);
    expect(titleIsPlaceholder('news.example.com', url)).toBe(true);
    expect(titleIsPlaceholder('https://news.example.com', url)).toBe(true);
    expect(titleIsPlaceholder('  ', url)).toBe(true);
  });

  it('leaves a typed title alone', () => {
    expect(titleIsPlaceholder('我的标题', url)).toBe(false);
    expect(titleIsPlaceholder('news.example.com notes', url)).toBe(false);
  });
});
