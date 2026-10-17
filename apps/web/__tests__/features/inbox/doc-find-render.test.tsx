import { findInArticleDoc, htmlToArticleDoc } from '@vital/article-doc';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderDoc } from '@/features/inbox/ReaderDoc';

describe('article find highlights', () => {
  it('marks each keyword and the current one', () => {
    const doc = htmlToArticleDoc('<p>见 <strong>keyword</strong> 与 keyword</p>');
    const hits = findInArticleDoc(doc, 'keyword', { matchCase: true });
    const view = render(
      <div className="reader-article">{renderDoc(doc, [], { hits, current: 1 })}</div>,
    );
    const marks = view.container.querySelectorAll('.doc-find-hit');
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toBe('keyword');
    expect(marks[0]).not.toHaveAttribute('data-find-current');
    expect(marks[1]).toHaveClass('doc-find-hit-current');
    expect(marks[1]).toHaveAttribute('data-find-current', 'true');
  });
});
