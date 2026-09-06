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

  it('keeps relative upload paths so rehosted images survive write', () => {
    const clean = sanitizeExtractedHtml(
      '<p><img src="/api/v1/uploads/11111111-1111-4111-8111-111111111111" alt="h"></p>',
    );
    expect(clean).toContain('/api/v1/uploads/11111111-1111-4111-8111-111111111111');
  });
});

describe('escapeParagraph', () => {
  it('escapes selection text', () => {
    expect(escapeParagraph('a <b> & "c"')).toBe('<p>a &lt;b&gt; &amp; &quot;c&quot;</p>');
  });
});
