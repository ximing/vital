import { describe, expect, it, vi } from 'vitest';
import { S3UnifiedStorageAdapter } from '../../src/storage/s3.adapter.js';

type Page = {
  parts: Array<{ PartNumber?: number; Size?: number; ETag?: string }>;
  truncated: boolean;
  marker?: number;
};

function adapterWithPages(pages: Page[]) {
  const adapter = new S3UnifiedStorageAdapter({
    bucket: 'b',
    prefix: '',
    region: 'r',
    accessKeyId: 'a',
    secretAccessKey: 's',
    isPublic: false,
  });
  let call = 0;
  (adapter as unknown as { client: { send: ReturnType<typeof vi.fn> } }).client.send = vi.fn(
    () => {
      const page = pages[Math.min(call, pages.length - 1)] ?? { parts: [], truncated: false };
      call += 1;
      return {
        Parts: page.parts,
        IsTruncated: page.truncated,
        NextPartNumberMarker: page.marker,
      };
    },
  );
  return adapter;
}

describe('S3 listParts', () => {
  it('concatenates pagination, keeps order, carries etags', async () => {
    const adapter = adapterWithPages([
      {
        parts: [
          { PartNumber: 2, Size: 5, ETag: '"e2"' },
          { PartNumber: 3, Size: 5, ETag: '"e3"' },
        ],
        truncated: true,
        marker: 3,
      },
      { parts: [{ PartNumber: 1, Size: 5, ETag: '"e1"' }], truncated: false },
    ]);
    const parts = await adapter.listParts('tmp/x.bin', 'up1');
    expect(parts).toEqual([
      { partNumber: 1, size: 5, etag: '"e1"' },
      { partNumber: 2, size: 5, etag: '"e2"' },
      { partNumber: 3, size: 5, etag: '"e3"' },
    ]);
    expect(
      (adapter as unknown as { client: { send: ReturnType<typeof vi.fn> } }).client.send,
    ).toHaveBeenCalledTimes(2);
  });

  it('tolerates missing etag and size fields', async () => {
    const adapter = adapterWithPages([
      { parts: [{ PartNumber: 1, ETag: '"e1"' }], truncated: false },
    ]);
    // Size undefined → entry skipped (incomplete part info)
    expect(await adapter.listParts('k', 'u')).toEqual([]);
  });
});
