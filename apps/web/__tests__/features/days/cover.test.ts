import { describe, expect, it } from 'vitest';
import { coverImageSrc } from '../../../src/features/days/CoverImage';

describe('coverImageSrc', () => {
  it('keeps the original for the large cover and uses a thumb for preset rows', () => {
    const absolute = 'http://localhost:5180/days/moon.jpg';
    expect(coverImageSrc(absolute, 'moon', 'full')).toBe(absolute);
    expect(coverImageSrc(absolute, 'moon', 'thumb')).toBe('/days/thumbs/moon.webp');
    expect(coverImageSrc('/days/river.jpg', 'river', 'thumb')).toBe('/days/thumbs/river.webp');
  });

  it('leaves an uploaded cover on its own url', () => {
    const uploaded = 'https://files.example/cover.jpg';
    expect(coverImageSrc(uploaded, 'mist', 'thumb')).toBe(uploaded);
  });
});
