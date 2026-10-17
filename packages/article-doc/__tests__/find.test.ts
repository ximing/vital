import { describe, expect, it } from 'vitest';
import { htmlToArticleDoc } from '../src/convert.js';
import {
  findInArticleDoc,
  findKeywordMatches,
  indexAfterArticleReplace,
  replaceInArticleDoc,
} from '../src/find.js';
import { articleDocToText } from '../src/text.js';
import type { ArticleDoc } from '../src/types.js';

describe('findKeywordMatches', () => {
  it('matches a literal keyword without overlap', () => {
    expect(findKeywordMatches('aaaa', 'aa', true)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    expect(findKeywordMatches('aaa', 'aa', true)).toEqual([{ start: 0, end: 2 }]);
  });

  it('ignores an empty query and can ignore case', () => {
    expect(findKeywordMatches('Word', '', false)).toEqual([]);
    expect(findKeywordMatches('Word', 'word', false)).toEqual([{ start: 0, end: 4 }]);
    expect(findKeywordMatches('Word', 'word', true)).toEqual([]);
  });

  it('matches Chinese keywords', () => {
    expect(findKeywordMatches('这是文档内的文档', '文档', true)).toEqual([
      { start: 2, end: 4 },
      { start: 6, end: 8 },
    ]);
  });
});

describe('article doc find and replace', () => {
  it('matches across inline marks and gives the replacement the first character marks', () => {
    const doc = htmlToArticleDoc('<p><strong>hel</strong>lo world</p>');
    const hits = findInArticleDoc(doc, 'hello', { matchCase: false });
    expect(hits).toHaveLength(1);
    const next = replaceInArticleDoc(doc, 'hello', 'HI', { matchCase: false, occurrence: 0 });
    expect(next.replaced).toBe(1);
    expect(next.doc.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'HI', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' world' },
      ],
    });
  });

  it('keeps marks on the unmatched side of a keyword', () => {
    const doc = htmlToArticleDoc('<p>say <a href="https://example.com">hello</a> there</p>');
    const next = replaceInArticleDoc(doc, 'hello', 'hi', { matchCase: true, occurrence: 0 });
    expect(next.doc.content[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'say ' },
        {
          type: 'text',
          text: 'hi',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
        { type: 'text', text: ' there' },
      ],
    });
  });

  it('does not match across paragraphs, and replaces one occurrence', () => {
    const doc = htmlToArticleDoc('<p>hel</p><p>lo keyword</p><p>keyword</p>');
    expect(findInArticleDoc(doc, 'hello', { matchCase: true })).toEqual([]);
    const hits = findInArticleDoc(doc, 'keyword', { matchCase: true });
    expect(hits.map((hit) => hit.index)).toEqual([0, 1]);
    const next = replaceInArticleDoc(doc, 'keyword', '词', { matchCase: true, occurrence: 1 });
    expect(next.replaced).toBe(1);
    expect(articleDocToText(next.doc)).toBe('hel\n\nlo keyword\n\n词');
  });

  it('replaces every match, including code, lists, and table cells', () => {
    const doc = htmlToArticleDoc(
      '<p>见 keyword</p><pre><code>keyword()</code></pre>' +
        '<ul><li><p>keyword</p></li></ul>' +
        '<table><tr><td>keyword</td></tr></table>',
    );
    const next = replaceInArticleDoc(doc, 'keyword', '词', { matchCase: true, occurrence: 'all' });
    expect(next.replaced).toBe(4);
    expect(articleDocToText(next.doc)).not.toContain('keyword');
    expect(articleDocToText(next.doc)).toContain('词');
  });

  it('does not search image alt text', () => {
    const doc = htmlToArticleDoc(
      '<img src="https://cdn.example.com/a.png" alt="keyword"><p>正文</p>',
    );
    expect(findInArticleDoc(doc, 'keyword', { matchCase: true })).toEqual([]);
  });

  it('deletes a keyword when the replacement is empty', () => {
    const doc: ArticleDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '去掉关键字吧' }] }],
    };
    const next = replaceInArticleDoc(doc, '关键字', '', { matchCase: true, occurrence: 'all' });
    expect(articleDocToText(next.doc)).toBe('去掉吧');
  });

  it('steps to the match after the replacement', () => {
    const doc = htmlToArticleDoc('<p>甲 keyword 乙 keyword</p>');
    const hits = findInArticleDoc(doc, 'keyword', { matchCase: true });
    const replaced = replaceInArticleDoc(doc, 'keyword', '词', { matchCase: true, occurrence: 0 });
    const after = findInArticleDoc(replaced.doc, 'keyword', { matchCase: true });
    const first = hits[0];
    expect(first).toBeDefined();
    expect(
      indexAfterArticleReplace(after, first?.path ?? [], (first?.start ?? 0) + '词'.length),
    ).toBe(0);
    expect(after).toHaveLength(1);
  });

  it('leaves the same doc when nothing matches', () => {
    const doc = htmlToArticleDoc('<p>没有</p>');
    const next = replaceInArticleDoc(doc, '关键字', 'x', { matchCase: true, occurrence: 'all' });
    expect(next.replaced).toBe(0);
    expect(next.doc).toBe(doc);
  });
});
