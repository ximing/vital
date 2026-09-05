import { ApiError } from '@vital/api-client';

const FALLBACK = '出了点问题，请重试';

export function humanError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message !== '') return err.message;
  return FALLBACK;
}
