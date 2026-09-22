import { describe, expect, it } from 'vitest';
import { escapeParagraph, textToHtml } from '../src/text.js';
import { tidyArticleHtml } from '../src/tidy.js';
import { WECHAT_HTML } from './fixtures.js';
import { expectEngineTagSets, parseBody, runDomPurify, runSanitizeHtml } from './helpers.js';

describe('tidyArticleHtml', () => {
  it('returns blank input unchanged', () => {
    expect(tidyArticleHtml('')).toBe('');
    expect(tidyArticleHtml('   ')).toBe('   ');
  });

  it('collapses WeChat wrappers, empty i/ul, player chrome, and data-src lazy images', () => {
    const out = tidyArticleHtml(WECHAT_HTML);
    expect(out).toContain('正文第一段');
    expect(out).toContain('正文第二段');
    expect(out).toContain('https://mmbiz.qpic.cn/hero.jpg');
    expect(out).toContain('视频 · 00:16');
    expect(out).not.toContain('data-src');
    expect(out).not.toContain('lazy.jpg');
    expect(out).not.toContain('data:image');
    expect(out).not.toMatch(/重播|退出全屏|您的浏览器不支持|继续观看|观看更多|已关注/);
    expect(out.match(/<br/g) ?? []).toEqual([]);
    const doc = parseBody(out);
    expect(doc.querySelector('section')).toBeNull();
    expect(doc.querySelector('i')).toBeNull();
    expect(doc.querySelectorAll('img')).toHaveLength(1);
  });

  it('does not drop td/th that contain text, including chrome-token overlap', () => {
    const html =
      '<table><tr><th><span>列</span></th><th></th></tr><tr><td>关注</td><td><span>分享</span></td></tr></table>';
    const out = tidyArticleHtml(html);
    expect((out.match(/<th/g) ?? []).length).toBe(2);
    expect((out.match(/<td/g) ?? []).length).toBe(2);
    expect(out).toContain('列');
    expect(out).toContain('关注');
    expect(out).toContain('分享');
  });

  it('keeps a single line break inside a paragraph', () => {
    expect(tidyArticleHtml('<p>hello<br>world</p>')).toBe('<p>hello<br>world</p>');
  });

  it('keeps separator punctuation between inline code', () => {
    const html =
      '<p>同时维护 Session 运行所依赖的 <code>cwd</code>、<code>settingsManager</code>、<code>modelRuntime</code>、<code>resourceLoader</code> 等 Services。</p>';
    expect(tidyArticleHtml(html)).toBe(html);
  });

  it('keeps other glue punctuation that is its own text or inline node', () => {
    const html = [
      '<p><code>src</code>/<code>tidy.ts</code>，<code>a</code>, <code>b</code>',
      '：<code>k</code>:<code>v</code> <code>50</code>%',
      '<code>pre</code>-<code>commit</code> <code>foo</code>_<code>bar</code>',
      '<code>a</code>|<code>b</code> <code>v1</code>.<code>2</code> ...</p>',
      '<p><code>cwd</code><em>、</em><b>，</b><strong>/</strong><i>-</i><code>x</code></p>',
      '<p>甲、乙、丙</p>',
    ].join('');
    expect(tidyArticleHtml(html)).toBe(html);
  });

  it('still drops player chrome that is only tokens glued by the same punctuation', () => {
    const out = tidyArticleHtml('<p>关注、分享、赞</p><p>高清/流畅</p><p>播放，倍速</p><p>正文保留。</p>');
    expect(out).not.toMatch(/关注|分享|赞|高清|流畅|播放|倍速/);
    expect(out).toContain('正文保留。');
  });

  it('sanitizers still drop data-* and keep the real image on the dirty fixture', () => {
    const sanitizeOut = runSanitizeHtml(WECHAT_HTML);
    const purifyOut = runDomPurify(WECHAT_HTML);
    for (const html of [sanitizeOut, purifyOut]) {
      expect(html).not.toContain('data-src');
      expect(html).toContain('https://mmbiz.qpic.cn/hero.jpg');
      expect(html).toContain('正文第一段');
    }
    expectEngineTagSets(sanitizeOut, purifyOut);
  });
});

describe('text helpers', () => {
  it('escapeParagraph wraps escaped text', () => {
    expect(escapeParagraph('a <b> & "c"')).toBe('<p>a &lt;b&gt; &amp; &quot;c&quot;</p>');
  });

  it('textToHtml splits on blank lines and escapes', () => {
    expect(textToHtml('a <b>\n\nb')).toBe('<p>a &lt;b&gt;</p><p>b</p>');
    expect(textToHtml('only')).toBe('<p>only</p>');
    expect(textToHtml('a\nb')).toBe('<p>a<br>b</p>');
  });
});
