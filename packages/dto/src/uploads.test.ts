import { describe, expect, it } from 'vitest';
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, uploadPresignInputSchema } from './uploads.js';

describe('uploads dto', () => {
  it('MAX_IMAGE_BYTES is 10MB', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('accepts image mime whitelist', () => {
    for (const mime of IMAGE_MIME_TYPES) {
      expect(uploadPresignInputSchema.safeParse({ mime, size: 1000 }).success).toBe(true);
    }
  });

  it('rejects SVG and non-image mime', () => {
    expect(uploadPresignInputSchema.safeParse({ mime: 'image/svg+xml', size: 1000 }).success).toBe(
      false,
    );
    expect(
      uploadPresignInputSchema.safeParse({ mime: 'application/pdf', size: 1000 }).success,
    ).toBe(false);
  });

  it('size must be a positive integer', () => {
    expect(uploadPresignInputSchema.safeParse({ mime: 'image/png', size: 0 }).success).toBe(false);
    expect(uploadPresignInputSchema.safeParse({ mime: 'image/png', size: 1.5 }).success).toBe(
      false,
    );
  });
});
