import { describe, expect, it } from 'vitest';
import { htmlToArticleDoc } from '../src/convert.js';
import type { ArticleBlockNode, ArticleInlineNode } from '../src/types.js';

function blocks(html: string): ArticleBlockNode[] {
  return htmlToArticleDoc(html).content;
}

function inline(block: ArticleBlockNode | undefined): ArticleInlineNode[] {
  if (block === undefined || !('content' in block)) return [];
  return block.content as ArticleInlineNode[];
}

describe('htmlToArticleDoc — blocks', () => {
  it('converts paragraphs and headings', () => {
    const doc = blocks('<p>第一段</p><h2>标题</h2><p>第二段</p>');
    expect(doc).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] },
    ]);
  });

  it('unwraps div/span wrappers and collapses whitespace', () => {
    const doc = blocks('<div><section><p><span>你好</span>   <span>世界</span></p></section></div>');
    expect(doc).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '你好 世界' }] },
    ]);
  });

  it('converts blockquote, pre and hr', () => {
    const doc = blocks('<blockquote><p>引用</p></blockquote><pre>line1\nline2\n</pre><hr>');
    expect(doc[0]).toEqual({
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用' }] }],
    });
    expect(doc[1]).toEqual({ type: 'codeBlock', content: [{ type: 'text', text: 'line1\nline2' }] });
    expect(doc[2]).toEqual({ type: 'horizontalRule' });
  });

  it('converts nested lists', () => {
    const doc = blocks('<ul><li>甲</li><li>乙<ul><li>乙一</li></ul></li></ul>');
    expect(doc).toEqual([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }] },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '乙' }] },
              {
                type: 'bulletList',
                content: [
                  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙一' }] }] },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('keeps ordered list start when greater than one', () => {
    const doc = blocks('<ol start="3"><li>三</li></ol>');
    expect(doc[0]).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
  });

  it('converts tables with header rows and captions', () => {
    const doc = blocks(
      '<table><caption>表标题</caption><thead><tr><th>列一</th><th>列二</th></tr></thead>' +
        '<tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    );
    expect(doc[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: '表标题' }] });
    const table = doc[1];
    expect(table?.type).toBe('table');
    if (table?.type !== 'table') return;
    expect(table.content[0]?.content.map((cell) => cell.type)).toEqual([
      'tableHeader',
      'tableHeader',
    ]);
    expect(table.content[1]?.content.map((cell) => cell.type)).toEqual(['tableCell', 'tableCell']);
  });

  it('unwraps figure and turns figcaption into a paragraph', () => {
    const doc = blocks(
      '<figure><img src="https://cdn.example.com/a.png"><figcaption>图注</figcaption></figure>',
    );
    expect(doc[0]).toMatchObject({ type: 'image', attrs: { src: 'https://cdn.example.com/a.png' } });
    expect(doc[1]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: '图注' }] });
  });
});

describe('htmlToArticleDoc — marks', () => {
  it('maps inline tags to marks', () => {
    const doc = blocks(
      '<p><strong>粗</strong><em>斜</em><u>下划</u><s>删</s><code>码</code><sub>下</sub><sup>上</sup><mark>亮</mark></p>',
    );
    const content = inline(doc[0]);
    expect(content).toEqual([
      { type: 'text', text: '粗', marks: [{ type: 'bold' }] },
      { type: 'text', text: '斜', marks: [{ type: 'italic' }] },
      { type: 'text', text: '下划', marks: [{ type: 'underline' }] },
      { type: 'text', text: '删', marks: [{ type: 'strike' }] },
      { type: 'text', text: '码', marks: [{ type: 'code' }] },
      { type: 'text', text: '下', marks: [{ type: 'subscript' }] },
      { type: 'text', text: '上', marks: [{ type: 'superscript' }] },
      { type: 'text', text: '亮', marks: [{ type: 'highlight' }] },
    ]);
  });

  it('nests marks and keeps safe links', () => {
    const doc = blocks('<p><strong>加粗<a href="https://example.com/x" title="题">链接</a></strong></p>');
    expect(inline(doc[0])).toEqual([
      { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
      {
        type: 'text',
        text: '链接',
        marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com/x', title: '题' } }],
      },
    ]);
  });

  it('unwraps unsafe links but keeps text', () => {
    const doc = blocks('<p><a href="javascript:alert(1)">点我</a></p>');
    expect(inline(doc[0])).toEqual([{ type: 'text', text: '点我' }]);
  });

  it('converts br to hardBreak', () => {
    const doc = blocks('<p>第一行<br>第二行</p>');
    expect(inline(doc[0])).toEqual([
      { type: 'text', text: '第一行' },
      { type: 'hardBreak' },
      { type: 'text', text: '第二行' },
    ]);
  });
});

describe('htmlToArticleDoc — media', () => {
  it('keeps http(s) images with alt/size and absolutizes protocol-relative src', () => {
    const doc = blocks(
      '<img src="https://cdn.example.com/a.png" alt="封面" width="640" height="360">' +
        '<img src="//cdn.example.com/b.png">',
    );
    expect(doc[0]).toEqual({
      type: 'image',
      attrs: { src: 'https://cdn.example.com/a.png', alt: '封面', width: 640, height: 360 },
    });
    expect(doc[1]).toEqual({ type: 'image', attrs: { src: 'https://cdn.example.com/b.png' } });
  });

  it('keeps upload refs and drops data:/blob: srcs', () => {
    const doc = blocks(
      '<img src="/api/v1/uploads/0f9c2c1e-1111-4222-8333-444455556666">' +
        '<img src="data:image/png;base64,AAAA"><img src="blob:https://x.com/1"><p>留</p>',
    );
    expect(doc).toEqual([
      { type: 'image', attrs: { src: '/api/v1/uploads/0f9c2c1e-1111-4222-8333-444455556666' } },
      { type: 'paragraph', content: [{ type: 'text', text: '留' }] },
    ]);
  });

  it('converts video with src/poster/type', () => {
    const doc = blocks(
      '<video src="https://cdn.example.com/v.mp4" poster="https://cdn.example.com/p.jpg" type="video/mp4" controls></video>',
    );
    expect(doc[0]).toEqual({
      type: 'video',
      attrs: {
        src: 'https://cdn.example.com/v.mp4',
        poster: 'https://cdn.example.com/p.jpg',
        mime: 'video/mp4',
      },
    });
  });

  it('falls back to source child for video src and mime', () => {
    const doc = blocks('<video controls><source src="https://cdn.example.com/v.webm" type="video/webm"></video>');
    expect(doc[0]).toEqual({
      type: 'video',
      attrs: { src: 'https://cdn.example.com/v.webm', mime: 'video/webm' },
    });
  });

  it('drops video without any src', () => {
    const doc = blocks('<video controls></video><p>留</p>');
    expect(doc).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: '留' }] }]);
  });

  it('lifts inline images out of paragraphs without losing order', () => {
    const doc = blocks('<p>前文 <img src="https://cdn.example.com/a.png"> 后文</p>');
    expect(doc.map((b) => b.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(inline(doc[0])[0]).toMatchObject({ text: '前文 ' });
    expect(inline(doc[2])[0]).toMatchObject({ text: ' 后文' });
  });

  it('lifts link-wrapped images', () => {
    const doc = blocks('<p><a href="https://example.com"><img src="https://cdn.example.com/a.png"></a></p>');
    expect(doc).toEqual([{ type: 'image', attrs: { src: 'https://cdn.example.com/a.png' } }]);
  });
});

describe('htmlToArticleDoc — robustness', () => {
  it('decodes entities and strips scripts/styles/iframes', () => {
    const doc = blocks(
      '<p>鱼&amp;羊 &lt;鲜&gt;</p><script>alert(1)</script><style>.x{}</style><iframe src="https://x.com"></iframe>',
    );
    expect(doc).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: '鱼&羊 <鲜>' }] }]);
  });

  it('keeps separator punctuation between inline code', () => {
    const doc = blocks(
      '<p>同时维护 Session 运行所依赖的 <code>cwd</code>、<code>settingsManager</code>、<code>modelRuntime</code>、<code>resourceLoader</code> 等 Services。</p>',
    );
    expect(inline(doc[0])).toEqual([
      { type: 'text', text: '同时维护 Session 运行所依赖的 ' },
      { type: 'text', text: 'cwd', marks: [{ type: 'code' }] },
      { type: 'text', text: '、' },
      { type: 'text', text: 'settingsManager', marks: [{ type: 'code' }] },
      { type: 'text', text: '、' },
      { type: 'text', text: 'modelRuntime', marks: [{ type: 'code' }] },
      { type: 'text', text: '、' },
      { type: 'text', text: 'resourceLoader', marks: [{ type: 'code' }] },
      { type: 'text', text: ' 等 Services。' },
    ]);
  });

  it('keeps other glue punctuation, including marks, and still drops glued player chrome', () => {
    const kept = blocks(
      '<p><code>src</code>/<code>tidy.ts</code>，<code>a</code>, <code>b</code>：<code>k</code>:<code>v</code> <code>50</code>% <code>pre</code>-<code>commit</code> <code>foo</code>_<code>bar</code> <code>a</code>|<code>b</code> <code>v1</code>.<code>2</code> ...</p>' +
        '<p><code>cwd</code><em>、</em><b>，</b><strong>/</strong><i>-</i></p>' +
        '<p>甲、乙、丙</p>',
    );
    expect(inline(kept[0]).map((node) => (node.type === 'text' ? node.text : '')).join('')).toBe(
      'src/tidy.ts，a, b：k:v 50% pre-commit foo_bar a|b v1.2 ...',
    );
    expect(inline(kept[1])).toEqual([
      { type: 'text', text: 'cwd', marks: [{ type: 'code' }] },
      { type: 'text', text: '、', marks: [{ type: 'italic' }] },
      { type: 'text', text: '，/', marks: [{ type: 'bold' }] },
      { type: 'text', text: '-', marks: [{ type: 'italic' }] },
    ]);
    expect(inline(kept[2])).toEqual([{ type: 'text', text: '甲、乙、丙' }]);

    const dropped = blocks('<p>关注、分享、赞</p><p>高清/流畅</p><p>播放，倍速</p><p>正文保留。</p>');
    const texts = dropped.map((block) =>
      'content' in block && Array.isArray(block.content) ? JSON.stringify(block.content) : '',
    );
    expect(texts.join('')).not.toMatch(/关注|分享|赞|高清|流畅|播放|倍速/);
    expect(texts.some((text) => text.includes('正文保留。'))).toBe(true);
  });

  it('scrubs WeChat player chrome but keeps duration captions', () => {
    const doc = blocks(
      '<p>分享视频，时长03:25</p><p>退出全屏 切换到竖屏全屏 播放 倍速 全屏</p><p>正文保留</p>',
    );
    const texts = doc.map((b) => ('content' in b && Array.isArray(b.content) ? JSON.stringify(b.content) : ''));
    expect(texts.some((t) => t.includes('视频 · 03:25'))).toBe(true);
    expect(texts.some((t) => t.includes('退出全屏'))).toBe(false);
    expect(texts.some((t) => t.includes('正文保留'))).toBe(true);
  });

  it('drops visually empty blocks', () => {
    const doc = blocks('<p></p><p>  </p><p>实</p>');
    expect(doc).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: '实' }] }]);
  });
});
