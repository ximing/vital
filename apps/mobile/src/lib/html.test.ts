import { describe, expect, it } from 'vitest';
import { htmlToText, looksLikeMarkdown } from './html';

describe('htmlToText', () => {
  it('strips tags and keeps list/paragraph breaks', () => {
    const html = '<p>你好</p><ul><li>一项</li><li>二项</li></ul><script>alert(1)</script>';
    expect(htmlToText(html)).toBe('你好\n\n· 一项\n· 二项');
  });

  it('decodes common entities', () => {
    expect(htmlToText('A&amp;B &lt;x&gt;')).toBe('A&B <x>');
  });
});

describe('looksLikeMarkdown', () => {
  it('detects headings and lists', () => {
    expect(looksLikeMarkdown('## 进行中')).toBe(true);
    expect(looksLikeMarkdown('- item')).toBe(true);
    expect(looksLikeMarkdown('plain paragraph')).toBe(false);
  });
});
