/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import {
  extractSemanticRoot,
  MIN_USEFUL_TEXT_CHARS,
  parseArticle,
} from '../src/parse-article.js';

const LONG = 'Vital captures later-read pages into the inbox. '.repeat(20);
const LONG_B = 'Selection and images follow the same silent save path. '.repeat(20);

const articleHtml = `<!doctype html>
<html>
  <head><title>A long enough article title</title></head>
  <body>
    <article>
      <h1>A long enough article title</h1>
      <p>${LONG}</p>
      <p>${LONG_B}</p>
      <img src="/hero.png" width="800" height="400" alt="hero" />
      <img src="/t.gif" width="1" height="1" />
    </article>
  </body>
</html>`;

const readabilityHtml = `<!doctype html>
<html>
  <head><title>A long enough article title</title></head>
  <body>
    <div id="story">
      <h1>A long enough article title</h1>
      <p>${LONG}</p>
      <p>${LONG_B}</p>
      <img src="/hero.png" width="800" height="400" alt="hero" />
      <img src="/t.gif" width="1" height="1" />
    </div>
  </body>
</html>`;

describe('parseArticle', () => {
  it('extracts article text and skips tracking pixels', () => {
    const parsed = parseArticle(articleHtml, 'https://news.example.com/story');
    expect(parsed.title.length).toBeGreaterThan(0);
    expect(parsed.extractedText === null || parsed.extractedText.length > 40).toBe(true);
    expect(parsed.imageSrcs).toContain('https://news.example.com/hero.png');
    expect(parsed.imageSrcs.some((src) => src.includes('t.gif'))).toBe(false);
  });

  it('falls back to Readability when no semantic content root exists', () => {
    const parsed = parseArticle(readabilityHtml, 'https://news.example.com/story');
    expect(parsed.extractedText ?? '').toContain('Vital captures later-read pages');
    expect(parsed.imageSrcs).toContain('https://news.example.com/hero.png');
  });
});

describe('semantic content root', () => {
  it('packs the densest matching root before Readability', () => {
    const html = `<!doctype html>
      <html>
        <head><title>Semantic story</title></head>
        <body>
          <nav><a href="/">Home</a><a href="/a">More</a></nav>
          <div class="entry-content">
            <p>${'SEMANTIC_BODY_TOKEN unique paragraph. '.repeat(12)}</p>
            <aside>ASIDE_IN_SEMANTIC</aside>
          </div>
        </body>
      </html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = extractSemanticRoot(doc);
    expect(root?.classList.contains('entry-content')).toBe(true);
    const parsed = parseArticle(html, 'https://blog.example.com/post');
    expect(parsed.extractedHtml).toContain('SEMANTIC_BODY_TOKEN');
    expect(parsed.extractedHtml).toContain('ASIDE_IN_SEMANTIC');
    expect(parsed.extractedText ?? '').toContain('SEMANTIC_BODY_TOKEN');
  });

  it('ignores a too-short semantic root and falls back to Readability', () => {
    const html = `<!doctype html>
      <html>
        <head><title>A long enough article title</title></head>
        <body>
          <div class="entry-content">tiny</div>
          <div id="story">
            <h1>A long enough article title</h1>
            <p>${LONG}</p>
            <p>${LONG_B}</p>
          </div>
        </body>
      </html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(extractSemanticRoot(doc)).toBeNull();
    const parsed = parseArticle(html, 'https://news.example.com/story');
    expect(parsed.extractedText ?? '').toContain('Vital captures later-read pages');
    expect(parsed.extractedText ?? '').not.toBe('tiny');
  });

  it('does not treat a missing semantic root as a hit', () => {
    const doc = new DOMParser().parseFromString(readabilityHtml, 'text/html');
    expect(extractSemanticRoot(doc)).toBeNull();
  });
});

describe('Readability short-text fallback', () => {
  it('uses body text when Readability is much shorter than the page', () => {
    const nav = Array.from(
      { length: 24 },
      (_, i) => `<a href="/p${i}">Nav link number ${i} with extra words</a>`,
    ).join('');
    const html = `<!doctype html>
      <html>
        <head><title>Mostly chrome</title></head>
        <body>
          <nav>${nav}</nav>
          <p>Hi.</p>
        </body>
      </html>`;
    const parsed = parseArticle(html, 'https://chrome.example.com/x');
    expect((parsed.extractedText ?? '').length).toBeGreaterThan(MIN_USEFUL_TEXT_CHARS);
    expect(parsed.extractedText).toContain('Nav link number');
    expect(parsed.extractedHtml).toContain('Nav link number');
  });
});

describe('parseArticle page mode', () => {
  it('keeps nested structure Readability would drop', () => {
    const html = `<!doctype html>
      <html>
        <head><title>A long enough article title</title></head>
        <body>
          <div id="app">
            <h1>A long enough article title</h1>
            <p>${LONG}</p>
            <p>${LONG_B}</p>
            <div class="sidebar">
              <p>SIDEBAR_TOKEN_PAGE_MODE</p>
            </div>
            <div class="comment">
              <blockquote><p>NESTED_QUOTE_TOKEN</p></blockquote>
            </div>
          </div>
        </body>
      </html>`;
    const article = parseArticle(html, 'https://news.example.com/story', 'article');
    const page = parseArticle(html, 'https://news.example.com/story', 'page');
    expect(page.extractedHtml).toContain('SIDEBAR_TOKEN_PAGE_MODE');
    expect(page.extractedHtml).toContain('NESTED_QUOTE_TOKEN');
    expect(page.extractedHtml).toContain('<blockquote>');
    expect(article.extractedHtml ?? '').not.toContain('SIDEBAR_TOKEN_PAGE_MODE');
    expect(article.extractedHtml ?? '').not.toContain('NESTED_QUOTE_TOKEN');
  });

  it('prefers a semantic root over the raw body when one qualifies', () => {
    const html = `<!doctype html>
      <html>
        <head><title>Blog post</title></head>
        <body>
          <header>SITE_CHROME_HEADER</header>
          <main>
            <p>${'PAGE_MODE_MAIN_TOKEN lives in the main landmark. '.repeat(10)}</p>
          </main>
        </body>
      </html>`;
    const page = parseArticle(html, 'https://blog.example.com/p', 'page');
    expect(page.extractedHtml).toContain('PAGE_MODE_MAIN_TOKEN');
    expect(page.extractedHtml).not.toContain('SITE_CHROME_HEADER');
  });
});
