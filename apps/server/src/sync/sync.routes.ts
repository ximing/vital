import { syncChangesQuerySchema } from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { attachSyncSocket } from './sync.hub.js';
import { getSyncChanges, getSyncHead } from './sync.service.js';

export function registerSyncRoutes(app: FastifyInstance): void {
  app.get('/api/v1/sync/head', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return getSyncHead(user.id);
  });

  app.get('/api/v1/sync/changes', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return getSyncChanges(user.id, syncChangesQuerySchema.parse(req.query));
  });

  app.get('/api/v1/sync/events', { websocket: true }, (socket) => {
    attachSyncSocket(socket);
  });
}
