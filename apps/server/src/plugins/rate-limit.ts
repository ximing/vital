import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export const isTest = config.NODE_ENV === 'test';

export const RATE_LIMIT_MESSAGE = {
  error: { code: 'RATE_LIMITED' as const, message: '请求过于频繁，请稍后再试' },
};

function expandIPv6(ip: string): string[] {
  const bare = (ip.split('%')[0] ?? ip).toLowerCase();
  const [head, tail] = bare.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = Math.max(8 - headParts.length - tailParts.length, 0);
  const parts = [...headParts, ...Array.from({ length: missing }, () => '0'), ...tailParts].map(
    (p) => p.padStart(4, '0'),
  );
  while (parts.length < 8) parts.push('0000');
  return parts.slice(0, 8);
}

/** IPv6 /56; IPv4 unchanged. */
export function ipKey(ip: string): string {
  const trimmed = ip.trim();
  const v4mapped = trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
  if (isIP(v4mapped) === 4) return v4mapped;
  if (isIP(trimmed) !== 6) return trimmed;
  const parts = expandIPv6(trimmed);
  const h3 = parts[3] ?? '0000';
  return `${parts[0] ?? '0000'}:${parts[1] ?? '0000'}:${parts[2] ?? '0000'}:${h3.slice(0, 2)}00::`;
}

export function ipFrom(req: FastifyRequest): string {
  return ipKey(req.ip || '0.0.0.0');
}

/** Same normalization as dto email schemas (trim + lower). */
export function emailFromBody(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'email' in body &&
    typeof body.email === 'string'
  ) {
    return body.email.trim().toLowerCase();
  }
  return '';
}

/** Plugin throws this; error-handler maps statusCode 429 → RATE_LIMITED envelope. */
export function rateLimitError(): Error {
  const err = new Error(RATE_LIMIT_MESSAGE.error.message);
  err.name = 'RateLimitError';
  Object.assign(err, { statusCode: 429, code: 'RATE_LIMITED' });
  return err;
}

export const globalRateLimit = {
  hook: 'preHandler' as const,
  global: true,
  max: isTest ? 1000 : 120,
  timeWindow: 60_000,
  keyGenerator: (req: FastifyRequest) => ipFrom(req),
  errorResponseBuilder: () => rateLimitError(),
};

const defaults = {
  register: isTest ? 1000 : 10,
  login: isTest ? 1000 : 5,
  changePassword: isTest ? 1000 : 10,
  refresh: isTest ? 1000 : 30,
  search: isTest ? 1000 : 20,
};

const authMax = { ...defaults };

type AuthKind = keyof typeof authMax;

const hits = new Map<string, { count: number; resetAt: number }>();

function hit(kind: AuthKind, key: string): void {
  const now = Date.now();
  const bucketKey = `${kind}:${key}`;
  let bucket = hits.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + 60_000 };
    hits.set(bucketKey, bucket);
  }
  bucket.count += 1;
  if (bucket.count > authMax[kind]) {
    logger.info('rate_limited_total', { kind });
    throw AppError.of(429, 'RATE_LIMITED');
  }
}

/** Auth caps stacked on the global 120/min/IP (route config.rateLimit would replace it). */
export function limitRegister(req: FastifyRequest): Promise<void> {
  hit('register', ipFrom(req));
  return Promise.resolve();
}

export function limitLogin(req: FastifyRequest): Promise<void> {
  hit('login', `${ipFrom(req)}:${emailFromBody(req.body)}`);
  return Promise.resolve();
}

export function limitChangePassword(req: FastifyRequest): Promise<void> {
  hit('changePassword', ipFrom(req));
  return Promise.resolve();
}

export function limitRefresh(req: FastifyRequest): Promise<void> {
  hit('refresh', ipFrom(req));
  return Promise.resolve();
}

export function limitSearch(req: FastifyRequest): Promise<void> {
  const userId = req.user?.id ?? '';
  hit('search', `${ipFrom(req)}:${userId}`);
  return Promise.resolve();
}

/** Test seam. Do not call from product code. */
export function setAuthRateLimits(partial: Partial<typeof authMax>): void {
  Object.assign(authMax, partial);
}

/** Test seam. Do not call from product code. */
export function resetAuthRateLimits(): void {
  Object.assign(authMax, defaults);
  hits.clear();
}
