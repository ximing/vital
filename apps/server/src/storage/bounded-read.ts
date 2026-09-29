export class ObjectTooLargeError extends Error {
  readonly key: string;
  readonly maxBytes: number;
  constructor(key: string, maxBytes: number) {
    super('OBJECT_TOO_LARGE');
    this.name = 'ObjectTooLargeError';
    this.key = key;
    this.maxBytes = maxBytes;
  }
}

export function abortS3Body(body: unknown): void {
  if (body && typeof body === 'object' && 'destroy' in body && typeof body.destroy === 'function') {
    (body as { destroy: (err?: Error) => void }).destroy();
  }
}

export async function readBodyWithLimit(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  key: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        abortS3Body(body);
        throw new ObjectTooLargeError(key, maxBytes);
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (err) {
    abortS3Body(body);
    throw err;
  }
  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, total);
}

/**
 * Read until maxBytes, then keep that prefix. A document larger than the
 * article we will store must still reach the parser.
 */
export async function readBodyPrefix(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let stopped = false;
  try {
    for await (const chunk of body) {
      if (total >= maxBytes) {
        stopped = true;
        break;
      }
      const buf = Buffer.from(chunk);
      const room = maxBytes - total;
      if (buf.byteLength > room) {
        chunks.push(buf.subarray(0, room));
        total = maxBytes;
        stopped = true;
        break;
      }
      chunks.push(buf);
      total += buf.byteLength;
    }
  } catch (err) {
    if (!stopped) {
      abortS3Body(body);
      throw err;
    }
  } finally {
    if (stopped) abortS3Body(body);
  }
  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, total);
}
