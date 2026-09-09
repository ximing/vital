import { isApiTokenSecret } from '@vital/dto';
import type { FastifyRequest } from 'fastify';
import { getAuthGate } from '../auth/auth.service.js';
import { verifyAccessToken } from '../auth/token.service.js';
import { AppError } from '../errors.js';
import { resolveApiToken } from '../tokens/tokens.service.js';

export async function populateUser(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return;
  const raw = header.slice(7);
  if (isApiTokenSecret(raw)) {
    try {
      const token = await resolveApiToken(raw);
      if (!token) return;
      req.user = { id: token.userId };
      req.apiToken = { id: token.id };
    } catch (err) {
      if (err instanceof AppError && (err.code === 'INVALID_TOKEN' || err.code === 'NOT_FOUND')) {
        return;
      }
      throw err;
    }
    return;
  }
  try {
    const { userId, iat } = verifyAccessToken(raw);
    const gate = await getAuthGate(userId);
    if (gate.passwordChangedAt && gate.passwordChangedAt.getTime() > iat * 1000) return;
    req.user = { id: gate.id };
  } catch (err) {
    // Invalid JWT or deleted user: stay anonymous. Operational errors (DB down) must 500.
    if (err instanceof AppError && (err.code === 'INVALID_TOKEN' || err.code === 'NOT_FOUND')) {
      return;
    }
    throw err;
  }
}

/** Promise-returning: a sync preHandler plus route-level rate-limit never continues. */
export function requireAuth(req: FastifyRequest): Promise<void> {
  if (!req.user) {
    return Promise.reject(AppError.of(401, 'INVALID_TOKEN'));
  }
  return Promise.resolve();
}
