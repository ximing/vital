import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  uploadPresignInputSchema,
} from '../src/uploads.js';

describe('uploads dto', () => {
  it('MAX_IMAGE_BYTES is 10MB', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('accepts image mime whitelist', () => {
    for (const mime of IMAGE_MIME_TYPES) {
      expect(uploadPresignInputSchema.safeParse({ mime, size: 1000 }).success).toBe(true);
    }
  });

  it('accepts report attachment mime', () => {
    for (const mime of ATTACHMENT_MIME_TYPES) {
      expect(uploadPresignInputSchema.safeParse({ mime, size: 1000 }).success).toBe(true);
    }
  });

  it('rejects SVG and executable mime', () => {
    expect(uploadPresignInputSchema.safeParse({ mime: 'image/svg+xml', size: 1000 }).success).toBe(
      false,
    );
    expect(
      uploadPresignInputSchema.safeParse({ mime: 'application/javascript', size: 1000 }).success,
    ).toBe(false);
  });

  it('size must be a positive integer', () => {
    expect(uploadPresignInputSchema.safeParse({ mime: 'image/png', size: 0 }).success).toBe(false);
    expect(uploadPresignInputSchema.safeParse({ mime: 'image/png', size: 1.5 }).success).toBe(
      false,
    );
  });
});
