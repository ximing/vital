import type { FastifyRequest } from 'fastify';
import { getUserEntity, toProfile } from '../auth/auth.service.js';
import { verifyAccessToken } from '../auth/token.service.js';
import { AppError } from '../errors.js';

export async function populateUser(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return;
  try {
    const { userId, iat } = verifyAccessToken(header.slice(7));
    const user = await getUserEntity(userId);
    if (user.passwordChangedAt && user.passwordChangedAt.getTime() > iat * 1000) return;
    req.user = await toProfile(user);
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
