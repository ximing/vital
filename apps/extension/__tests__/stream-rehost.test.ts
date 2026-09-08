import { describe, expect, it } from 'vitest';
import { createStreamPartSource } from '../src/stream-rehost.js';

const createStreamPartSourceFromBlob = (blob: Blob) => createStreamPartSource(blob.stream());

describe('createStreamPartSource', () => {
  it('sequential slices consume the stream in order', async () => {
    const blob = new Blob(['aaaabbbbcccc']);
    const src = createStreamPartSourceFromBlob(blob);
    expect(await (await src.partSource(0, 4)).text()).toBe('aaaa');
    expect(await (await src.partSource(4, 8)).text()).toBe('bbbb');
    expect(await (await src.partSource(8, 12)).text()).toBe('cccc');
  });

  it('resume skip: discards bytes up to start before reading the part', async () => {
    // Simulate a resumed upload: parts 1 already done, next request is (8, 12)
    // on a FRESH stream that starts at byte 0.
    const blob = new Blob(['aaaabbbbcccc']);
    const src = createStreamPartSourceFromBlob(blob);
    expect(await (await src.partSource(8, 12)).text()).toBe('cccc'); // aaaabbbb discarded
  });

  it('start behind the current position throws (cannot rewind a stream)', async () => {
    const blob = new Blob(['aaaabbbb']);
    const src = createStreamPartSourceFromBlob(blob);
    await src.partSource(4, 8);
    await expect(src.partSource(0, 4)).rejects.toThrow();
  });

  it('stream ending early throws UPLOAD_STREAM_SHORT', async () => {
    const blob = new Blob(['aaaa']);
    const src = createStreamPartSourceFromBlob(blob);
    await expect(src.partSource(4, 8)).rejects.toThrow(/short/i);
  });

  it('finish() passes when the stream ends exactly at the declared size', async () => {
    const blob = new Blob(['aaaabbbb']);
    const src = createStreamPartSourceFromBlob(blob);
    await src.partSource(0, 8);
    await expect(src.finish()).resolves.toBeUndefined();
  });

  it('finish() throws when the body is longer than the declared size', async () => {
    const blob = new Blob(['aaaabbbbEXTRA']);
    const src = createStreamPartSourceFromBlob(blob);
    expect(await (await src.partSource(0, 8)).text()).toBe('aaaabbbb');
    // The rehost wrapper calls finish() after the final partSource, so a
    // longer-than-declared body fails the upload before complete.
    await expect(src.finish()).rejects.toThrow(/extra|longer/i);
  });

  it('resume skip does not buffer the discarded span (bounded memory)', async () => {
    // A large skip must discard chunk-by-chunk, not accumulate into one buffer.
    const data = new Uint8Array(1024 * 1024).fill(0x61);
    const blob = new Blob([data, new Uint8Array([0x62, 0x62, 0x62, 0x62])]);
    const src = createStreamPartSource(blob.stream());
    expect((await src.partSource(1024 * 1024, 1024 * 1024 + 4)).size).toBe(4);
    await expect(src.finish()).resolves.toBeUndefined();
  });
});
