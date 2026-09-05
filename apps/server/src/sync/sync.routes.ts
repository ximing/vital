import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { getSyncHead } from './sync.service.js';

export function registerSyncRoutes(app: FastifyInstance): void {
  app.get('/api/v1/sync/head', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return getSyncHead(user.id);
  });
}
