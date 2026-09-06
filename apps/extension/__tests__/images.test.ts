/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { collectArticleImages, isTrackingPixel, sniffMime } from '../src/images.js';

describe('isTrackingPixel', () => {
  it('skips 1x1 and tracker hosts/paths', () => {
    expect(isTrackingPixel({ src: 'https://cdn.ex.com/p.png', width: 1, height: 1 })).toBe(true);
    expect(isTrackingPixel({ src: 'https://ex.com/pixel.gif' })).toBe(true);
    expect(isTrackingPixel({ src: 'https://www.google-analytics.com/collect' })).toBe(true);
    expect(isTrackingPixel({ src: 'https://cdn.ex.com/hero.jpg', width: 800, height: 400 })).toBe(
      false,
    );
  });
});

describe('collectArticleImages', () => {
  it('resolves relative src, caps, and skips tracking pixels / svg', () => {
    const html = `
      <article>
        <img src="/hero.png" width="800" height="400" />
        <img src="https://cdn.ex.com/a.jpg" width="640" height="320" />
        <img src="/pixel.gif" width="1" height="1" />
        <img src="/mark.svg" width="64" height="64" />
        <img src="https://www.google-analytics.com/collect" />
      </article>`;
    expect(collectArticleImages(html, 'https://news.example.com/p', 10)).toEqual([
      'https://news.example.com/hero.png',
      'https://cdn.ex.com/a.jpg',
    ]);
  });
});

describe('sniffMime', () => {
  it('detects jpeg/png magic', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffMime(jpeg.buffer)).toBe('image/jpeg');
    expect(sniffMime(png.buffer)).toBe('image/png');
  });
});
