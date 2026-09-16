/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { clip, escapeParagraph, isHttpUrl, parseDim, tidyArticleHtml } from '../src/html.js';

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

describe('tidyArticleHtml', () => {
  it('drops WeChat empty sections/spans and keeps real paragraphs and images', () => {
    const html = `<section><section>
      <section><span><br></span></section>
      <p><span><br></span></p>
      <p><span>正文第一段。</span></p>
      <p><span><br></span></p>
      <section><img src="https://mmbiz.qpic.cn/hero.jpg" alt="图"></section>
      <p>正文第二段。</p>
    </section></section>`;
    const out = tidyArticleHtml(html);
    expect(out).toContain('正文第一段');
    expect(out).toContain('正文第二段');
    expect(out).toContain('https://mmbiz.qpic.cn/hero.jpg');
    expect(out.match(/<br/g) ?? []).toEqual([]);
    expect(out.match(/<p>/g)?.length).toBe(2);
  });

  it('strips leftover WeChat player chrome and keeps duration', () => {
    const html = `<p>3D样板间：消费者可以在场景中查看商品陈列效果</p>
      <img alt="">
      已关注 <i></i> 关注 <i></i> 重播 分享 赞 关闭
      <strong>观看更多</strong>
      大淘宝技术已关注分享视频，时长00:16
      <p>0/0</p>
      您的浏览器不支持 video 标签
      <p>继续观看</p>
      <p>基于图像的三维重建技术。</p>`;
    const out = tidyArticleHtml(html);
    expect(out).toContain('3D样板间');
    expect(out).toContain('基于图像的三维重建技术');
    expect(out).toContain('视频 · 00:16');
    expect(out).not.toMatch(/重播|退出全屏|您的浏览器不支持|继续观看|观看更多/);
  });

  it('keeps a single line break inside a paragraph', () => {
    expect(tidyArticleHtml('<p>hello<br>world</p>')).toBe('<p>hello<br>world</p>');
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
});
