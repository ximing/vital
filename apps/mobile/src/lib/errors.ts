import { ApiError } from '@vital/api-client';
import { ERROR_MESSAGES, type ErrorCode } from '@vital/dto';

const FALLBACK = '出了点问题，请重试';

function isErrorCode(code: string): code is ErrorCode {
  return code in ERROR_MESSAGES;
}

export function humanError(err: unknown): string {
  if (err instanceof ApiError) {
    if (isErrorCode(err.code)) return ERROR_MESSAGES[err.code];
    if (err.message !== '') return err.message;
    if (err.status === 401) return ERROR_MESSAGES.INVALID_TOKEN;
    if (err.code === 'NETWORK_ERROR') return '网络不太好，请重试';
    return FALLBACK;
  }
  if (err instanceof Error && err.message !== '') return err.message;
  return FALLBACK;
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'NETWORK_ERROR' || err.status === 0);
}
