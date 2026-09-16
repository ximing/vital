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

  it('keeps video and poster so WeChat clips survive write', () => {
    const clean = sanitizeExtractedHtml(
      '<figure><video src="https://cdn.example/a.mp4" poster="https://cdn.example/p.jpg" controls playsinline></video><figcaption>视频 · 00:16</figcaption></figure>',
    );
    expect(clean).toContain('<video');
    expect(clean).toContain('https://cdn.example/a.mp4');
    expect(clean).toContain('https://cdn.example/p.jpg');
    expect(clean).toContain('视频 · 00:16');
  });

  it('keeps relative upload paths so rehosted images survive write', () => {
    const clean = sanitizeExtractedHtml(
      '<p><img src="/api/v1/uploads/11111111-1111-4111-8111-111111111111" alt="h"></p>',
    );
    expect(clean).toContain('/api/v1/uploads/11111111-1111-4111-8111-111111111111');
  });

  it('keeps article structure tags and table/list/time/details attributes', () => {
    const clean = sanitizeExtractedHtml(
      [
        '<table><thead><tr><th colspan="2" scope="col">H</th></tr></thead>',
        '<tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>',
        '<dl><dt>Term</dt><dd>Def</dd></dl>',
        '<p>H<sub>2</sub>O <sup>n</sup> <mark>hit</mark> <kbd>Ctrl</kbd></p>',
        '<ol start="3" reversed><li value="9">nine</li></ol>',
        '<p><time datetime="2026-01-02">Jan 2</time></p>',
        '<details open><summary>More</summary><p>body</p></details>',
        '<p><del>old</del> <ins>new</ins></p>',
        '<picture><source srcset="https://cdn.example/a.webp" type="image/webp"><img src="https://cdn.example/a.jpg" alt="p"></picture>',
      ].join(''),
    );
    expect(clean).toContain('<table>');
    expect(clean).toContain('colspan="2"');
    expect(clean).toContain('rowspan="2"');
    expect(clean).toContain('scope="col"');
    expect(clean).toContain('<dl>');
    expect(clean).toContain('<dt>Term</dt>');
    expect(clean).toContain('<dd>Def</dd>');
    expect(clean).toContain('<sub>2</sub>');
    expect(clean).toContain('<sup>n</sup>');
    expect(clean).toContain('<mark>hit</mark>');
    expect(clean).toContain('<kbd>Ctrl</kbd>');
    expect(clean).toContain('start="3"');
    expect(clean).toContain('reversed');
    expect(clean).toContain('value="9"');
    expect(clean).toContain('datetime="2026-01-02"');
    expect(clean).toContain('<details');
    expect(clean).toContain('open');
    expect(clean).toContain('<summary>More</summary>');
    expect(clean).toContain('<del>old</del>');
    expect(clean).toContain('<ins>new</ins>');
    expect(clean).toContain('<picture>');
  });

  it('still strips dangerous protocols and event handlers', () => {
    const clean = sanitizeExtractedHtml(
      '<p onclick="alert(1)" style="color:red"><a href="javascript:alert(1)">x</a><a href="data:text/html,y">y</a><img src="javascript:alert(1)"></p>',
    );
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('data:');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('style=');
    expect(clean).not.toContain('alert');
  });
});

describe('escapeParagraph', () => {
  it('escapes selection text', () => {
    expect(escapeParagraph('a <b> & "c"')).toBe('<p>a &lt;b&gt; &amp; &quot;c&quot;</p>');
  });
});
