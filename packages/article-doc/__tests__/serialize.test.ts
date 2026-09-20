import { describe, expect, it } from 'vitest';
import { htmlToArticleDoc } from '../src/convert.js';
import { articleDocToHtml } from '../src/serialize.js';
import { articleDocToText, textToArticleDoc } from '../src/text.js';

function roundTrip(html: string): string {
  return articleDocToHtml(htmlToArticleDoc(articleDocToHtml(htmlToArticleDoc(html))));
}

describe('articleDocToHtml', () => {
  it('serializes blocks and marks with correct escaping', () => {
    const doc = htmlToArticleDoc(
      '<h2>标题 &amp; 副题</h2><p>普通<strong>粗<em>粗斜</em></strong><a href="https://example.com">链</a></p>' +
        '<ul><li>甲</li></ul><pre>a&lt;b&gt;&amp;</pre>',
    );
    const html = articleDocToHtml(doc);
    expect(html).toContain('<h2>标题 &amp; 副题</h2>');
    expect(html).toContain('<strong>粗</strong><strong><em>粗斜</em></strong>');
    expect(html).toContain('<a href="https://example.com">链</a>');
    expect(html).toContain('<ul><li><p>甲</p></li></ul>');
    expect(html).toContain('<pre><code>a&lt;b&gt;&amp;</code></pre>');
  });

  it('serializes image and video with attrs', () => {
    const doc = htmlToArticleDoc(
      '<img src="https://cdn.example.com/a.png" alt="封" width="640">' +
        '<video src="https://cdn.example.com/v.mp4" poster="https://cdn.example.com/p.jpg" type="video/mp4"></video>',
    );
    const html = articleDocToHtml(doc);
    expect(html).toContain('<img src="https://cdn.example.com/a.png" alt="封" width="640">');
    expect(html).toContain(
      '<video src="https://cdn.example.com/v.mp4" poster="https://cdn.example.com/p.jpg" type="video/mp4" controls playsinline>',
    );
  });

  it('is idempotent through doc → html → doc → html', () => {
    const source =
      '<h2>题</h2><p>段<strong>粗</strong></p><img src="https://cdn.example.com/a.png">' +
      '<video><source src="https://cdn.example.com/v.mp4" type="video/mp4"></video>' +
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>' +
      '<blockquote><p>引</p></blockquote><ol start="2"><li>二</li></ol>';
    const once = articleDocToHtml(htmlToArticleDoc(source));
    expect(roundTrip(source)).toBe(once);
  });
});

describe('textToArticleDoc', () => {
  it('splits paragraphs on blank lines and hard-breaks single newlines', () => {
    const doc = textToArticleDoc('第一\n行\n\n第二段');
    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '第一' },
            { type: 'hardBreak' },
            { type: 'text', text: '行' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] },
      ],
    });
  });

  it('round-trips through the html serializer', () => {
    const html = articleDocToHtml(textToArticleDoc('甲\n\n乙'));
    expect(html).toBe('<p>甲</p><p>乙</p>');
  });
});

describe('articleDocToText', () => {
  it('flattens headings and lists', () => {
    expect(
      articleDocToText({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }],
              },
            ],
          },
        ],
      }),
    ).toBe('标题\n\n- 甲');
  });
});

