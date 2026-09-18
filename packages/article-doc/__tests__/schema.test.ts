import { describe, expect, it } from 'vitest';
import { htmlToArticleDoc } from '../src/convert.js';
import { articleDocSchema } from '../src/schema.js';
import { uploadRefOf } from '../src/refs.js';

const ATT = '0f9c2c1e-1111-4222-8333-444455556666';

describe('articleDocSchema', () => {
  it('accepts converter output', () => {
    const doc = htmlToArticleDoc(
      '<h2>题</h2><p>段<strong>粗</strong><a href="https://example.com">链</a></p>' +
        '<img src="https://cdn.example.com/a.png">' +
        `<img src="${uploadRefOf(ATT)}">` +
        '<video><source src="https://cdn.example.com/v.mp4" type="video/mp4"></video>' +
        '<ul><li>甲</li></ul><table><tr><td>1</td></tr></table><pre>x</pre><hr>',
    );
    const result = articleDocSchema.safeParse(doc);
    expect(result.success).toBe(true);
  });

  it('rejects unknown node types and strips unknown attrs', () => {
    expect(
      articleDocSchema.safeParse({ type: 'doc', content: [{ type: 'script', attrs: {} }] }).success,
    ).toBe(false);
    // zod strips unknown keys: the doc is accepted but the rogue attr is gone.
    const parsed = articleDocSchema.safeParse({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', onClick: 'evil' }] }],
    });
    expect(parsed.success).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain('onClick');
  });

  it('rejects javascript: hrefs and illegal media srcs', () => {
    expect(
      articleDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      articleDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'data:image/png;base64,AA' } }],
      }).success,
    ).toBe(false);
    expect(
      articleDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: '/api/v1/uploads/not-a-uuid' } }],
      }).success,
    ).toBe(false);
  });

  it('rejects non-doc roots and malformed headings', () => {
    expect(articleDocSchema.safeParse({ type: 'document', content: [] }).success).toBe(false);
    expect(
      articleDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 9 }, content: [] }],
      }).success,
    ).toBe(false);
  });
});
