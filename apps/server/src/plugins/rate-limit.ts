import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
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

function emailFromBody(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'email' in body &&
    typeof body.email === 'string'
  ) {
    return body.email.toLowerCase();
  }
  return '';
}

export const globalRateLimit = {
  hook: 'preHandler' as const,
  max: isTest ? 1000 : 120,
  timeWindow: 60_000,
  keyGenerator: (req: FastifyRequest) => ipFrom(req),
  errorResponseBuilder: () => RATE_LIMIT_MESSAGE,
};

export const registerRateLimit = {
  max: isTest ? 1000 : 10,
  timeWindow: 60_000,
  keyGenerator: (req: FastifyRequest) => ipFrom(req),
};

export const loginRateLimit = {
  max: isTest ? 1000 : 5,
  timeWindow: 60_000,
  keyGenerator: (req: FastifyRequest) => `${ipFrom(req)}:${emailFromBody(req.body)}`,
};

export const changePasswordRateLimit = {
  max: isTest ? 1000 : 10,
  timeWindow: 60_000,
  keyGenerator: (req: FastifyRequest) => ipFrom(req),
};

export const refreshRateLimit = {
  max: isTest ? 1000 : 30,
  timeWindow: 60_000,
  keyGenerator: (req: FastifyRequest) => ipFrom(req),
};
