export interface StreamPartSource {
  partSource: (start: number, end: number) => Promise<Blob>;
}

/**
 * Byte-aligned part source over a network stream. Ascending slices consume
 * the stream; a skip (resume) first discards bytes up to `start`. A request
 * behind the current position throws — streams cannot rewind.
 */
export function createStreamPartSource(
  stream: ReadableStream<Uint8Array>,
): StreamPartSource {
  const reader = stream.getReader();
  let consumed = 0;
  let buffer = new Uint8Array(0);

  async function ensure(n: number): Promise<Uint8Array> {
    while (buffer.length < n) {
      const { done, value } = await reader.read();
      if (done || value === undefined) {
        throw new Error(`UPLOAD_STREAM_SHORT: stream ended at ${consumed + buffer.length}, need ${n}`);
      }
      const next = new Uint8Array(buffer.length + value.length);
      next.set(buffer);
      next.set(value, buffer.length);
      buffer = next;
    }
    return buffer;
  }

  async function discard(n: number): Promise<void> {
    await ensure(n);
    buffer = buffer.slice(n);
    consumed += n;
  }

  return {
    async partSource(start: number, end: number): Promise<Blob> {
      if (start < consumed) {
        throw new Error(`UPLOAD_STREAM_REWIND: requested ${start}, already at ${consumed}`);
      }
      if (start > consumed) {
        await discard(start - consumed);
      }
      const need = end - start;
      const data = await ensure(need);
      const part = data.slice(0, need);
      buffer = data.slice(need);
      consumed += need;
      return new Blob([part]);
    },
  };
}
