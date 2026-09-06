/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import {
  collectArticleImages,
  isTrackingPixel,
  rewriteExtractedImageSrcs,
  shouldConvertImage,
  sniffMime,
} from '../src/images.js';

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
  it('resolves relative src and skips tracking pixels / svg', () => {
    const html = `
      <article>
        <img src="/hero.png" width="800" height="400" />
        <img src="https://cdn.ex.com/a.jpg" width="640" height="320" />
        <img src="/pixel.gif" width="1" height="1" />
        <img src="/mark.svg" width="64" height="64" />
        <img src="https://www.google-analytics.com/collect" />
      </article>`;
    expect(collectArticleImages(html, 'https://news.example.com/p')).toEqual([
      'https://news.example.com/hero.png',
      'https://cdn.ex.com/a.jpg',
    ]);
  });

  it('keeps every article image instead of stopping at 10', () => {
    const imgs = Array.from(
      { length: 15 },
      (_, i) => `<img src="/p${String(i)}.png" width="800" height="400" />`,
    ).join('');
    expect(
      collectArticleImages(`<article>${imgs}</article>`, 'https://news.example.com/p'),
    ).toHaveLength(15);
  });

  it('promotes data-src and the largest srcset candidate', () => {
    const html = `
      <article>
        <img data-src="https://cdn.ex.com/lazy.jpg" width="800" height="400" />
        <img srcset="https://cdn.ex.com/a.jpg 640w, https://cdn.ex.com/a-2x.jpg 1280w" />
      </article>`;
    expect(collectArticleImages(html, 'https://news.example.com/p')).toEqual([
      'https://cdn.ex.com/lazy.jpg',
      'https://cdn.ex.com/a-2x.jpg',
    ]);
  });
});

describe('rewriteExtractedImageSrcs', () => {
  it('rewrites img src to our upload path so the reader never hotlinks', () => {
    const html = '<p><img src="https://cdn.ex.com/hero.jpg" alt="h"></p>';
    const out = rewriteExtractedImageSrcs(html, [
      { originalSrc: 'https://cdn.ex.com/hero.jpg', uploadPath: '/api/v1/uploads/att-1' },
    ]);
    expect(out).toContain('src="/api/v1/uploads/att-1"');
    expect(out).not.toContain('cdn.ex.com');
  });
});

describe('shouldConvertImage', () => {
  it('passes through jpeg/png/webp/gif and converts other rasters', () => {
    expect(shouldConvertImage('image/jpeg')).toBe(false);
    expect(shouldConvertImage('image/png')).toBe(false);
    expect(shouldConvertImage('image/webp')).toBe(false);
    expect(shouldConvertImage('image/gif')).toBe(false);
    expect(shouldConvertImage('image/avif')).toBe(true);
    expect(shouldConvertImage('image/bmp')).toBe(true);
    expect(shouldConvertImage(null)).toBe(true);
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
