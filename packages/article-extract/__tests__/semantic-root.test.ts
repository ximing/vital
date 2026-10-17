/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { extractSemanticRoot, parseArticle } from '../src/parse-article.js';

function page(body: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${body}</body></html>`,
    'text/html',
  );
}

function rootId(body: string): string | null {
  return extractSemanticRoot(page(body))?.id ?? null;
}

describe('extractSemanticRoot', () => {
  it('keeps a landmark that has no nested candidate', () => {
    const prose = 'm'.repeat(200);
    expect(rootId(`<main id="main"><p>${prose}</p></main>`)).toBe('main');
    expect(rootId(`<article id="article"><p>${prose}</p></article>`)).toBe('article');
  });

  it('prefers the inner candidate at the 80% boundary and keeps the outer just below it', () => {
    const inner = 'a'.repeat(800);
    expect(
      rootId(`<main id="outer"><p>${'m'.repeat(200)}</p><article id="inner">${inner}</article></main>`),
    ).toBe('inner');
    expect(
      rootId(`<main id="outer"><p>${'m'.repeat(201)}</p><article id="inner">${inner}</article></main>`),
    ).toBe('outer');
  });

  it('prefers the innermost root when each shell is mostly that root', () => {
    const body = [
      '<main id="main"><div class="entry-content" id="entry">',
      `<article id="article">${'a'.repeat(900)}</article>`,
      `<p>${'e'.repeat(100)}</p>`,
      '</div>',
      `<p>${'m'.repeat(50)}</p>`,
      '</main>',
    ].join('');
    expect(rootId(body)).toBe('article');
  });

  it('keeps the middle root when the inner article is only a small part of it', () => {
    const body = [
      '<main id="main"><div class="entry-content" id="entry">',
      `<article id="article">${'a'.repeat(200)}</article>`,
      `<p>${'e'.repeat(800)}</p>`,
      '</div>',
      `<p>${'m'.repeat(50)}</p>`,
      '</main>',
    ].join('');
    expect(rootId(body)).toBe('entry');
  });

  it('keeps main when two articles each hold less than 80%', () => {
    const body = `<main id="main"><article id="a">${'a'.repeat(500)}</article><article id="b">${'b'.repeat(500)}</article></main>`;
    expect(rootId(body)).toBe('main');
  });

  it('picks the longer of two sibling articles, and the first when they tie', () => {
    expect(
      rootId(
        `<article id="short">${'a'.repeat(200)}</article><article id="long">${'b'.repeat(800)}</article>`,
      ),
    ).toBe('long');
    expect(
      rootId(
        `<article id="first">${'a'.repeat(200)}</article><article id="second">${'b'.repeat(200)}</article>`,
      ),
    ).toBe('first');
  });

  it('treats role=main and .post the same as main', () => {
    expect(
      rootId(
        `<div role="main" id="outer"><article id="inner">${'a'.repeat(800)}</article><p>${'m'.repeat(100)}</p></div>`,
      ),
    ).toBe('inner');
    expect(
      rootId(
        `<div class="post" id="post"><div class="article" id="article">${'a'.repeat(800)}</div><p>${'p'.repeat(50)}</p></div>`,
      ),
    ).toBe('article');
  });

  it('ignores a nested candidate that is too short or only links', () => {
    expect(
      rootId(`<main id="main"><article id="tiny">short</article><p>${'m'.repeat(200)}</p></main>`),
    ).toBe('main');
    const links = '<a href="/x">linktext</a>'.repeat(20);
    expect(rootId(`<main id="main"><article id="links">${links}</article><p>${'p'.repeat(400)}</p></main>`)).toBe(
      'main',
    );
  });

  it('still reaches an article nested through a non-landmark div', () => {
    const body = `<main id="main"><div><article id="article">${'a'.repeat(800)}</article></div><p>${'m'.repeat(100)}</p></main>`;
    expect(rootId(body)).toBe('article');
  });
});

describe('parseArticle with a nested landmark', () => {
  const prose = 'INNER_ARTICLE_TOKEN explains the notebook. '.repeat(12);

  function cookbook(sibling = ''): string {
    return `<!doctype html><html><head><title>Cookbook</title></head><body>
      <main>
        <header><a href="/cookbook/">CHROME_CATEGORY</a></header>
        <article>
          <h2>Inner title</h2>
          <p>${prose}</p>
          <div class="font-mono">
            <div data-code-line="">def hi():</div>
            <div data-code-line="">    return 1</div>
          </div>
          <pre>output line</pre>
        </article>
        ${sibling}
      </main>
    </body></html>`;
  }

  it('stores the inner article in both modes, with code lines still broken into lines', () => {
    const html = cookbook();
    for (const mode of ['article', 'page'] as const) {
      const parsed = parseArticle(html, 'https://platform.claude.com/cookbook/example', mode);
      expect(parsed.extractedHtml).toContain('<h2>');
      expect(parsed.extractedHtml).toContain('<pre>def hi():\n    return 1</pre>');
      expect(parsed.extractedHtml).toContain('<pre>output line</pre>');
      expect(parsed.extractedHtml).not.toContain('CHROME_CATEGORY');
      expect(parsed.extractedHtml).not.toContain('data-code-line');
    }
  });

  it('keeps main when the article is not most of it, so the sibling section is stored', () => {
    const html = cookbook(`<section>${'SIDE_SECTION_TOKEN '.repeat(80)}</section>`);
    const parsed = parseArticle(html, 'https://platform.claude.com/cookbook/example');
    expect(parsed.extractedHtml).toContain('CHROME_CATEGORY');
    expect(parsed.extractedHtml).toContain('SIDE_SECTION_TOKEN');
    expect(parsed.extractedHtml).toContain('<pre>def hi():\n    return 1</pre>');
  });
});
