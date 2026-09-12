import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText, looksLikeMarkdown } from '../../src/lib/html';

describe('decodeEntities', () => {
  it('decodes hexadecimal numeric references', () => {
    expect(decodeEntities('买菜&#x20;清单')).toBe('买菜 清单');
  });

  it('decodes decimal numeric references', () => {
    expect(decodeEntities('a&#32;b&#39;c')).toBe("a b'c");
  });

  it('decodes a mix of named and numeric references', () => {
    expect(decodeEntities('A&amp;B&#x20;&lt;x&gt;')).toBe('A&B <x>');
  });

  it('leaves invalid or out-of-range references untouched', () => {
    expect(decodeEntities('&#x110000; &#0; &unknown;')).toBe('&#x110000; &#0; &unknown;');
  });
});

describe('htmlToText', () => {
  it('strips tags and keeps list/paragraph breaks', () => {
    const html = '<p>你好</p><ul><li>一项</li><li>二项</li></ul><script>alert(1)</script>';
    expect(htmlToText(html)).toBe('你好\n\n· 一项\n· 二项');
  });

  it('decodes common entities', () => {
    expect(htmlToText('A&amp;B &lt;x&gt;')).toBe('A&B <x>');
  });

  it('decodes numeric character references', () => {
    expect(htmlToText('<p>一&#x20;二&#32;三</p>')).toBe('一 二 三');
  });
});

describe('looksLikeMarkdown', () => {
  it('detects headings and lists', () => {
    expect(looksLikeMarkdown('## 进行中')).toBe(true);
    expect(looksLikeMarkdown('- item')).toBe(true);
    expect(looksLikeMarkdown('plain paragraph')).toBe(false);
  });
});
