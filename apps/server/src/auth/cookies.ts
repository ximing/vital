import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

export const REFRESH_COOKIE_NAME = 'vital_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function isCookieMode(req: FastifyRequest): boolean {
  return req.headers.origin === config.WEB_ORIGIN;
}

function cookieBase() {
  return {
    httpOnly: true as const,
    path: REFRESH_COOKIE_PATH,
    sameSite: 'lax' as const,
    signed: true as const,
    secure: config.COOKIE_SECURE,
  };
}

export function setRefreshCookie(reply: FastifyReply, raw: string): void {
  void reply.setCookie(REFRESH_COOKIE_NAME, raw, {
    ...cookieBase(),
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  void reply.setCookie(REFRESH_COOKIE_NAME, '', {
    ...cookieBase(),
    maxAge: 0,
  });
}

export function readRefreshCookie(req: FastifyRequest): string | undefined {
  const raw = req.cookies[REFRESH_COOKIE_NAME];
  if (!raw) return undefined;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid) return undefined;
  return unsigned.value;
}

export function deviceInfoFrom(req: FastifyRequest): string | undefined {
  const ua = req.headers['user-agent'];
  if (typeof ua !== 'string' || ua.length === 0) return undefined;
  return ua.slice(0, 255);
}
