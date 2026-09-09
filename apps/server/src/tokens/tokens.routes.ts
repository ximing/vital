import {
  apiTokenIdParamsSchema,
  createApiTokenInputSchema,
  listApiTokenAccessQuerySchema,
} from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import {
  createApiToken,
  listApiTokenAccess,
  listApiTokens,
  revokeApiToken,
} from './tokens.service.js';

export function registerTokenRoutes(app: FastifyInstance): void {
  /** List active personal access tokens. The secret is never returned. */
  app.get('/api/v1/tokens', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listApiTokens(user.id);
  });

  /** Create a personal access token. The secret is returned once. */
  app.post('/api/v1/tokens', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const created = await createApiToken(user.id, createApiTokenInputSchema.parse(req.body));
    return reply.code(201).send(created);
  });

  /** Access logs for one token, newest first, retained 30 days. */
  app.get('/api/v1/tokens/:id/access', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = apiTokenIdParamsSchema.parse(req.params);
    return listApiTokenAccess(user.id, id, listApiTokenAccessQuerySchema.parse(req.query));
  });

  /** Revoke a personal access token. Existing logs are kept until they expire. */
  app.delete('/api/v1/tokens/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = apiTokenIdParamsSchema.parse(req.params);
    await revokeApiToken(user.id, id);
    return reply.code(204).send();
  });
}
