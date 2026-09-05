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
