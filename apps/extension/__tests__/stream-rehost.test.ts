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
});
