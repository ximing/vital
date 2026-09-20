import { describe, expect, it } from 'vitest';
import { pmJsonToArticleDoc } from '../src/from-pm.js';
import { articleDocToText } from '../src/text.js';

describe('pmJsonToArticleDoc', () => {
  it('maps headings, marks, lists, and lifts inline images to blocks', () => {
    const doc = pmJsonToArticleDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '你好', marks: [{ type: 'bold' }] },
            { type: 'image', attrs: { src: 'https://cdn.example.com/a.png', alt: '图' } },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '要点' }] }],
            },
          ],
        },
      ],
    });
    expect(doc.content.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'image',
      'bulletList',
    ]);
    expect(doc.content[2]).toMatchObject({
      type: 'image',
      attrs: { src: 'https://cdn.example.com/a.png', alt: '图' },
    });
  });

  it('renders vitalEntity chips as [[kind:id]] text', () => {
    const doc = pmJsonToArticleDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '见 ' },
            {
              type: 'vitalEntity',
              attrs: { kind: 'task', id: '11111111-1111-4111-8111-111111111111' },
            },
          ],
        },
      ],
    });
    expect(articleDocToText(doc)).toBe('见 [[task:11111111-1111-4111-8111-111111111111]]');
  });
});
