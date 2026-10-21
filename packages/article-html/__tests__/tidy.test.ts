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

  it('keeps WeChat code-block breaks that sit alone inside a span', () => {
    const html = [
      '<pre><code>',
      '<span leaf="">最终 patch</span>',
      '<span leaf=""><br></span>',
      '<span leaf="">&nbsp; &nbsp;│</span>',
      '<span leaf=""><br></span>',
      '<span leaf=""><br></span>',
      '<span leaf="">next</span>',
      '<span leaf=""><br></span>',
      '</code></pre>',
    ].join('');
    const pre = parseBody(tidyArticleHtml(html)).querySelector('pre');
    expect(pre?.querySelectorAll('br')).toHaveLength(4);
    expect(pre?.textContent).toContain('最终 patch');
    expect(pre?.textContent).toContain('next');
  });

  it('keeps notebook code lines as a pre block, including indent and blank lines', () => {
    const html = [
      '<p>Create a <code>.env</code> file:</p>',
      '<div class="group">',
      '<button type="button" aria-label="Copy code"><span>copy</span></button>',
      '<div class="code-scroll-region"><div class="font-mono">',
      '<div data-code-line="">def hi():</div>',
      '<div data-code-line="" style="padding-left:4ch;text-indent:-4ch">    return 1</div>',
      '<div data-code-line=""></div>',
      '<div data-code-line="">print(hi())</div>',
      '</div></div></div>',
      '<p>Next.</p>',
    ].join('');
    const out = tidyArticleHtml(html);
    const pre = parseBody(out).querySelector('pre');
    expect(pre?.textContent).toBe('def hi():\n    return 1\n\nprint(hi())');
    expect(pre?.textContent).not.toContain('copy');
    expect(out).toContain('<code>.env</code>');
    expect(out).toContain('<p>Next.</p>');
    expect(out).not.toContain('data-code-line');
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

describe('notebook code lines', () => {
  function preTexts(html: string): string[] {
    return [...parseBody(tidyArticleHtml(html)).querySelectorAll('pre')].map(
      (el) => el.textContent,
    );
  }

  it('keeps a single line and blank lines between lines, and drops a trailing blank line', () => {
    expect(preTexts('<div data-code-line="">only</div>')).toEqual(['only']);
    // A blank first line is a leading newline in <pre>, which HTML parsing discards.
    expect(
      preTexts(
        '<div><div data-code-line=""></div><div data-code-line="">a</div><div data-code-line=""></div><div data-code-line=""></div><div data-code-line="">b</div><div data-code-line=""></div></div>',
      ),
    ).toEqual(['a\n\n\nb']);
  });

  it('turns nbsp into spaces and concatenates highlight spans without losing the gap', () => {
    const html =
      '<div data-code-line="">&nbsp;&nbsp;<span class="k">def</span> <span class="n">hi</span>():</div>';
    expect(preTexts(html)).toEqual(['  def hi():']);
  });

  it('keeps comparison operators as text', () => {
    expect(preTexts('<div data-code-line="">a &lt; b &amp;&amp; c</div>')).toEqual(['a < b && c']);
  });

  it('keeps separate cells in order, with the prose between them', () => {
    const html = [
      '<p>before</p>',
      '<div><div data-code-line="">first</div></div>',
      '<p>between</p>',
      '<div><div data-code-line="">second</div><div data-code-line="">  tail</div></div>',
      '<pre>already\n  indented</pre>',
    ].join('');
    const out = tidyArticleHtml(html);
    expect(preTexts(html)).toEqual(['first', 'second\n  tail', 'already\n  indented']);
    expect(out).toContain('<p>before</p>');
    expect(out).toContain('<p>between</p>');
  });

  it('leaves a non-line sibling outside the pre', () => {
    const out = tidyArticleHtml(
      '<div class="card"><button type="button">copy</button><div data-code-line="">one</div><div data-code-line="">two</div></div>',
    );
    const doc = parseBody(out);
    expect(doc.querySelector('pre')?.textContent).toBe('one\ntwo');
    expect(doc.querySelector('pre')?.textContent).not.toContain('copy');
    expect(doc.querySelector('button')?.textContent).toBe('copy');
  });

  it('joins lines that already sit in pre or code, without nesting another pre', () => {
    const pre = tidyArticleHtml(
      '<pre><div data-code-line="">alpha</div><div data-code-line="">  beta</div></pre>',
    );
    expect(parseBody(pre).querySelectorAll('pre')).toHaveLength(1);
    expect(parseBody(pre).querySelector('pre')?.textContent).toBe('alpha\n  beta');

    const code = tidyArticleHtml(
      '<code><span data-code-line="">a</span><span data-code-line=""> b</span></code>',
    );
    const codeEl = parseBody(code).querySelector('code');
    expect(codeEl?.textContent).toBe('a\n b');
    expect(parseBody(code).querySelector('pre')).toBeNull();
  });

  it('does not scrub chrome words once they are inside a code block', () => {
    const out = tidyArticleHtml(
      '<div data-code-line="">关注、分享</div><p>关注、分享、赞</p><p>正文保留。</p>',
    );
    expect(parseBody(out).querySelector('pre')?.textContent).toBe('关注、分享');
    expect(out).not.toMatch(/<p>[^<]*关注/);
    expect(out).toContain('正文保留。');
  });
});

describe('article and main wrappers', () => {
  it('unwraps nested main and article without flattening the body', () => {
    const html = [
      '<main><article>',
      '<h2><div><button type="button">x</button></div>Title</h2>',
      '<p>See <code>cwd</code>、<code>x</code>.</p>',
      '<ul><li>one</li></ul>',
      '<blockquote><p>quote</p></blockquote>',
      '<table><tr><td>关注</td><td>cell</td></tr></table>',
      '<div class="font-mono"><div data-code-line="">def hi():</div><div data-code-line="">    return 1</div></div>',
      '<pre>output</pre>',
      '</article></main>',
    ].join('');
    const out = tidyArticleHtml(html);
    const doc = parseBody(out);
    expect(doc.querySelector('article, main')).toBeNull();
    expect(doc.querySelector('h2')?.textContent).toContain('Title');
    expect(out).toContain('<code>cwd</code>、<code>x</code>');
    expect(doc.querySelector('ul li')?.textContent).toBe('one');
    expect(doc.querySelector('blockquote')?.textContent).toBe('quote');
    expect(doc.querySelector('td')?.textContent).toBe('关注');
    expect([...doc.querySelectorAll('pre')].map((el) => el.textContent)).toEqual([
      'def hi():\n    return 1',
      'output',
    ]);
  });

  it('still unwraps a section that is not a landmark', () => {
    const out = tidyArticleHtml('<section><p>正文第一段</p></section>');
    expect(parseBody(out).querySelector('section')).toBeNull();
    expect(out).toContain('<p>正文第一段</p>');
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
