import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_PARTS,
  MIN_UPLOAD_PART_BYTES,
  isUploadableMime,
  partSizeFor,
  totalPartsFor,
  uploadInitInputSchema,
  uploadCompletePartsInputSchema,
} from '../src/uploads.js';

const UUID = '1b671a64-40d5-491e-99b0-da01ff1f3341';

describe('upload constants and mime', () => {
  it('includes video and audio mimes, still no svg', () => {
    for (const mime of [
      'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
      'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/flac',
    ]) {
      expect(ATTACHMENT_MIME_TYPES).toContain(mime);
      expect(isUploadableMime(mime)).toBe(true);
    }
    expect(isUploadableMime('image/svg+xml')).toBe(false);
    expect(isUploadableMime('application/x-msdownload')).toBe(false);
  });

  it('caps single file at 5GB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 ** 3);
  });
});

describe('part sizing', () => {
  it('small files use the 5MB minimum', () => {
    expect(partSizeFor(1024)).toBe(MIN_UPLOAD_PART_BYTES);
    expect(totalPartsFor(1024)).toBe(1);
    expect(totalPartsFor(MIN_UPLOAD_PART_BYTES)).toBe(1);
    expect(totalPartsFor(MIN_UPLOAD_PART_BYTES + 1)).toBe(2);
  });

  it('huge files stay within the 10000-part S3 limit', () => {
    const size = MAX_UPLOAD_BYTES;
    // 5GB / 10000 = ~524KB < 5MB, so the 5MB floor wins at the cap.
    expect(partSizeFor(size)).toBe(MIN_UPLOAD_PART_BYTES);
    expect(totalPartsFor(size)).toBe(Math.ceil(size / MIN_UPLOAD_PART_BYTES));
    expect(totalPartsFor(size)).toBeLessThanOrEqual(MAX_UPLOAD_PARTS);
  });
});

describe('multipart schemas', () => {
  it('init accepts shape with optional resumeId (valid uuid)', () => {
    expect(uploadInitInputSchema.parse({ mime: 'video/mp4', size: 1000 })).toEqual({
      mime: 'video/mp4', size: 1000,
    });
    expect(
      uploadInitInputSchema.parse({ mime: 'application/pdf', size: 10, resumeId: UUID }),
    ).toMatchObject({ resumeId: UUID });
    expect(
      uploadInitInputSchema.safeParse({ mime: 'video/mp4', size: 'big' }).success,
    ).toBe(false);
    expect(
      uploadInitInputSchema.safeParse({ mime: 'video/mp4', size: 10, resumeId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('complete parts need 1..10000 parts', () => {
    expect(
      uploadCompletePartsInputSchema.parse({ parts: [{ partNumber: 1, etag: '"e1"' }] }),
    ).toEqual({ parts: [{ partNumber: 1, etag: '"e1"' }] });
    expect(uploadCompletePartsInputSchema.safeParse({ parts: [] }).success).toBe(false);
  });
});
