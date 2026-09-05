/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { parseArticle } from './parse-article.js';

const articleHtml = `<!doctype html>
<html>
  <head><title>A long enough article title</title></head>
  <body>
    <article>
      <h1>A long enough article title</h1>
      <p>${'Vital captures later-read pages into the inbox. '.repeat(20)}</p>
      <p>${'Selection and images follow the same silent save path. '.repeat(20)}</p>
      <img src="/hero.png" width="800" height="400" alt="hero" />
      <img src="/t.gif" width="1" height="1" />
    </article>
  </body>
</html>`;

describe('parseArticle', () => {
  it('runs Readability via DOMParser and skips tracking pixels', () => {
    const parsed = parseArticle(articleHtml, 'https://news.example.com/story');
    expect(parsed.title.length).toBeGreaterThan(0);
    expect(parsed.extractedText === null || parsed.extractedText.length > 40).toBe(true);
    expect(parsed.imageSrcs).toContain('https://news.example.com/hero.png');
    expect(parsed.imageSrcs.some((src) => src.includes('t.gif'))).toBe(false);
  });
});
