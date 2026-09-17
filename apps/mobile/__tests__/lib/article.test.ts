import { describe, expect, it } from 'vitest';
import type { InboxAsset } from '@vital/dto';
import {
  isMarkdownWrapperHtml,
  prepareArticleNodes,
  readerSource,
} from '../../src/lib/article';
import { isElement, textContent, type HtmlNode } from '../../src/lib/html-ast';

function textOf(nodes: HtmlNode[]): string {
  return textContent(nodes).replace(/\s+/g, ' ').trim();
}

function tags(nodes: HtmlNode[]): string[] {
  return nodes.filter(isElement).map((node) => node.tag);
}

function findTag(nodes: HtmlNode[], tag: string): HtmlNode | undefined {
  for (const node of nodes) {
    if (isElement(node) && node.tag === tag) return node;
    if (isElement(node)) {
      const hit = findTag(node.children, tag);
      if (hit) return hit;
    }
  }
  return undefined;
}

const imageAsset: InboxAsset = {
  id: 'as1',
  attachmentId: '11111111-1111-4111-8111-111111111111',
  url: 'https://s3.test/signed-image',
  mime: 'image/jpeg',
  originalSrc: 'https://x.test/a.png',
  sortOrder: 0,
};

describe('readerSource', () => {
  it('prefers HTML when it has real tags, even if text looks like markdown', () => {
    const html = '<p>see <a href="https://x.test/a">link</a></p><p>next</p>';
    const text = 'see link\n\n- next is a list-looking line';
    expect(isMarkdownWrapperHtml(html)).toBe(false);
    expect(readerSource(html, text)).toBe(html);
    const link = findTag(prepareArticleNodes(html, text, []), 'a');
    expect(link && isElement(link) ? link.attrs.href : null).toBe('https://x.test/a');
  });

  it('renders markdown when HTML is only an escaped wrapper', () => {
    const html = '<p># 标题\n\n**粗体**\n\n- 一项</p>';
    const md = '# 标题\n\n**粗体**\n\n- 一项';
    expect(isMarkdownWrapperHtml(html)).toBe(true);
    const source = readerSource(html, md);
    expect(source).toContain('<h1>');
    expect(source).toContain('<strong>');
    expect(source).toContain('<li>');
  });

  it('turns plain text into paragraphs', () => {
    expect(readerSource(null, 'a\n\nb')).toBe('a\n\nb'.split('\n\n').map((p) => `<p>${p}</p>`).join(''));
    expect(readerSource(null, 'only')).toBe('<p>only</p>');
  });
});

describe('prepareArticleNodes', () => {
  it('keeps headings lists quotes and links', () => {
    const nodes = prepareArticleNodes(
      '<h2>鉴权</h2><p>在设置 → <a href="https://example.com">令牌</a>。</p><ul><li>一项</li><li>二项</li></ul><blockquote><p>引用</p></blockquote>',
      null,
      [],
    );
    expect(tags(nodes)).toEqual(['h2', 'p', 'ul', 'blockquote']);
    expect(textOf(nodes)).toContain('鉴权');
    expect(textOf(nodes)).toContain('一项');
    const link = findTag(nodes, 'a');
    expect(link && isElement(link) ? link.attrs.href : null).toBe('https://example.com');
  });

  it('strips WeChat chrome and empty wrappers', () => {
    const html = `<section><section>
      <span><br></span>
      <p><span><br></span></p>
      <p><span>正文第一段。</span></p>
      <p><span><br></span></p>
      <p>已关注</p>
      重播 分享 赞 关闭
      <strong>观看更多</strong>
      大淘宝技术已关注分享视频，时长00:16
      您的浏览器不支持 video 标签
      <p>继续观看</p>
      <p>正文第二段。</p>
    </section></section>`;
    const nodes = prepareArticleNodes(html, null, []);
    const text = textOf(nodes);
    expect(text).toContain('正文第一段');
    expect(text).toContain('正文第二段');
    expect(text).toContain('视频 · 00:16');
    expect(text).not.toMatch(/已关注|重播|继续观看|您的浏览器不支持/);
    expect(nodes.filter((node) => isElement(node) && node.tag === 'p').length).toBeLessThanOrEqual(4);
  });

  it('rewrites article images to signed asset URLs and drops data URIs', () => {
    const nodes = prepareArticleNodes(
      '<p>hi</p><img src="https://x.test/a.png" alt="图"><img src="data:image/gif;base64,xx" alt="x">',
      null,
      [imageAsset],
    );
    const img = findTag(nodes, 'img');
    expect(img && isElement(img) ? img.attrs.src : null).toBe('https://s3.test/signed-image');
    expect(nodes.filter((node) => isElement(node) && node.tag === 'img')).toHaveLength(1);
  });

  it('drops javascript links and script tags', () => {
    const nodes = prepareArticleNodes(
      '<p>safe</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><p onclick="alert(1)">hi</p>',
      null,
      [],
    );
    expect(textOf(nodes)).toContain('safe');
    expect(textOf(nodes)).toContain('hi');
    expect(textOf(nodes)).not.toContain('alert');
    const link = findTag(nodes, 'a');
    expect(link && isElement(link) ? link.attrs.href : undefined).toBeUndefined();
  });

  it('renders markdown documents with headings, emphasis, lists, and leftover body', () => {
    const md = '# 标题\n正文紧跟标题\n\n## 小标题\n\n一段 **粗** 和 _斜_。\n\n- 一项\n- 二项\n\n> 引用';
    const nodes = prepareArticleNodes('<p># 标题</p>', md, []);
    expect(tags(nodes).slice(0, 3)).toEqual(['h1', 'p', 'h2']);
    expect(textOf(nodes)).toContain('正文紧跟标题');
    expect(textOf(nodes)).toContain('一项');
    expect(findTag(nodes, 'strong')).toBeTruthy();
    expect(findTag(nodes, 'em')).toBeTruthy();
    expect(findTag(nodes, 'blockquote')).toBeTruthy();
  });

  it('keeps br between text in a paragraph', () => {
    const nodes = prepareArticleNodes('<p>第一行<br>第二行</p>', null, []);
    const p = findTag(nodes, 'p');
    expect(p && isElement(p)).toBe(true);
    const kids = p && isElement(p) ? p.children : [];
    expect(kids.filter(isElement).map((n) => n.tag)).toEqual(['br']);
    expect(kids.filter((n) => n.type === 'text').map((n) => (n.type === 'text' ? n.value : ''))).toEqual([
      '第一行',
      '第二行',
    ]);
  });

  it('keeps pre/code leading indentation', () => {
    const nodes = prepareArticleNodes('<pre><code>\n  foo\n    bar\n</code></pre>', null, []);
    expect(textContent(nodes)).toBe('\n  foo\n    bar\n');
  });

  it('keeps video source src', () => {
    const nodes = prepareArticleNodes(
      '<video controls><source src="https://cdn.ex.com/a.mp4" type="video/mp4"></video>',
      null,
      [],
    );
    const source = findTag(nodes, 'source');
    expect(source && isElement(source) ? source.attrs.src : null).toBe('https://cdn.ex.com/a.mp4');
  });

  it('rewrites protocol-relative image URLs to https', () => {
    const nodes = prepareArticleNodes('<p><img src="//cdn.ex.com/a.png" alt="x"></p>', null, []);
    const img = findTag(nodes, 'img');
    expect(img && isElement(img) ? img.attrs.src : null).toBe('https://cdn.ex.com/a.png');
  });

  it('keeps table cells', () => {
    const nodes = prepareArticleNodes(
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>A</td></tr></tbody></table>',
      null,
      [],
    );
    const table = findTag(nodes, 'table');
    expect(table).toBeTruthy();
    expect(textOf(nodes)).toContain('H');
    expect(textOf(nodes)).toContain('A');
  });
});
