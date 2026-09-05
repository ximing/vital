import { ERROR_MESSAGES, type ErrorCode } from '@vital/dto';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static of(status: number, code: ErrorCode, details?: unknown): AppError {
    if (details !== undefined) {
      return new AppError(status, code, ERROR_MESSAGES[code], details);
    }
    return new AppError(status, code, ERROR_MESSAGES[code]);
  }
}
