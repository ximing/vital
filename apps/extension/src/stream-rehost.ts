export interface StreamPartSource {
  partSource: (start: number, end: number) => Promise<Blob>;
  /** Fails unless the stream ended exactly at the bytes consumed so far. */
  finish: () => Promise<void>;
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
    // Read-and-drop in bounded chunks so a multi-GB resume skip never
    // buffers more than one chunk in the service worker.
    while (n > 0) {
      if (buffer.length > 0) {
        const take = Math.min(buffer.length, n);
        buffer = buffer.slice(take);
        consumed += take;
        n -= take;
        continue;
      }
      const { done, value } = await reader.read();
      if (done || value === undefined) {
        throw new Error(`UPLOAD_STREAM_SHORT: stream ended at ${consumed}, expected ${consumed + n} more`);
      }
      const take = Math.min(value.length, n);
      buffer = value.slice(take); // keep only the overflow
      consumed += take;
      n -= take;
    }
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
    /** Integrity gate: the stream must end exactly at the declared size. Call
     * after the last part is read so a truncated or over-long body fails the
     * upload instead of completing with corrupted bytes. */
    async finish(): Promise<void> {
      if (buffer.length > 0) {
        throw new Error(`UPLOAD_STREAM_EXTRA: ${buffer.length} unread bytes past the declared size`);
      }
      for (;;) {
        const { done, value } = await reader.read();
        if (done || value === undefined) return;
        if (value.length > 0) {
          throw new Error('UPLOAD_STREAM_EXTRA: stream longer than the declared size');
        }
      }
    },
  };
}
