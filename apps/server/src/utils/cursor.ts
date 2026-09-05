import { AppError } from '../errors.js';

export interface CursorPayload {
  t: string;
  id: string;
}

export function encodeCursor(t: string, id: string): string {
  return Buffer.from(JSON.stringify({ t, id }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): CursorPayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('t' in parsed) ||
      !('id' in parsed) ||
      typeof parsed.t !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new Error('bad cursor');
    }
    return { t: parsed.t, id: parsed.id };
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
}
