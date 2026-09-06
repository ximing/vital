import {
  createNotificationChannelInputSchema,
  notificationChannelIdParamsSchema,
  patchNotificationChannelInputSchema,
} from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { limitNotify } from '../plugins/rate-limit.js';
import {
  createChannel,
  deleteChannel,
  listChannels,
  patchChannel,
  testChannel,
} from './channels.service.js';

export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get('/api/v1/notification-channels', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listChannels(user.id);
  });

  app.post(
    '/api/v1/notification-channels',
    { preHandler: [requireAuth, limitNotify] },
    async (req, reply) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      const created = await createChannel(
        user.id,
        createNotificationChannelInputSchema.parse(req.body),
      );
      return reply.code(201).send(created);
    },
  );

  app.patch('/api/v1/notification-channels/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = notificationChannelIdParamsSchema.parse(req.params);
    return patchChannel(user.id, id, patchNotificationChannelInputSchema.parse(req.body));
  });

  app.delete(
    '/api/v1/notification-channels/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      const { id } = notificationChannelIdParamsSchema.parse(req.params);
      await deleteChannel(user.id, id);
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/v1/notification-channels/:id/test',
    { preHandler: [requireAuth, limitNotify] },
    async (req, reply) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      const { id } = notificationChannelIdParamsSchema.parse(req.params);
      await testChannel(user.id, id);
      return reply.code(204).send();
    },
  );
}
