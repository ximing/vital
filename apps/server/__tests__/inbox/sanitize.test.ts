import { describe, expect, it } from 'vitest';
import { escapeParagraph, sanitizeExtractedHtml } from '../../src/inbox/sanitize.js';

describe('sanitizeExtractedHtml', () => {
  it('strips script and javascript urls on write', () => {
    const clean = sanitizeExtractedHtml(
      '<p>Hi</p><script>alert(1)</script><img src="javascript:alert(1)"><a href="https://ok.example">x</a>',
    );
    expect(clean).toContain('<p>Hi</p>');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('https://ok.example');
  });
});

describe('escapeParagraph', () => {
  it('escapes selection text', () => {
    expect(escapeParagraph('a <b> & "c"')).toBe('<p>a &lt;b&gt; &amp; &quot;c&quot;</p>');
  });
});
