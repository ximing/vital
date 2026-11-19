import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import {
  beginOidc,
  clearOidcCookie,
  completeOidc,
  oidcAccount,
  oidcFailureLocation,
  oidcStatus,
} from './oidc.service.js';

function returnQuery(query: unknown): string | undefined {
  if (typeof query !== 'object' || query === null || !('return' in query)) return undefined;
  const value = (query as { return?: unknown }).return;
  return typeof value === 'string' ? value : undefined;
}

export function registerOidcRoutes(app: FastifyInstance): void {
  app.get('/api/auth/oidc/status', () => oidcStatus());

  app.get('/api/auth/oidc/start', async (req, reply) => {
    try {
      const location = await beginOidc(req, reply, 'login', returnQuery(req.query));
      return await reply.redirect(location);
    } catch {
      clearOidcCookie(reply);
      return await reply.redirect(oidcFailureLocation('login', 'OIDC_UNAVAILABLE'));
    }
  });

  app.get('/api/auth/oidc/callback', async (req, reply) => {
    try {
      const location = await completeOidc(req, reply);
      return await reply.redirect(location);
    } catch {
      clearOidcCookie(reply);
      return await reply.redirect(oidcFailureLocation('login', 'OIDC_UNAVAILABLE'));
    }
  });

  app.get('/api/v1/auth/oidc', { preHandler: [requireAuth] }, async (req: FastifyRequest) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return oidcAccount(user.id);
  });

  app.get('/api/v1/auth/oidc/bind/start', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const location = await beginOidc(req, reply, 'bind', returnQuery(req.query));
      return await reply.redirect(location);
    } catch {
      clearOidcCookie(reply);
      return await reply.redirect(oidcFailureLocation('bind', 'OIDC_UNAVAILABLE'));
    }
  });
}
