import { registerPushDeviceInputSchema } from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { limitNotify } from '../plugins/rate-limit.js';
import { upsertPushDevice } from './push-devices.service.js';

export function registerPushRoutes(app: FastifyInstance): void {
  app.post(
    '/api/v1/push-devices',
    { preHandler: [requireAuth, limitNotify] },
    async (req, reply) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      const input = registerPushDeviceInputSchema.parse(req.body);
      const created = await upsertPushDevice(user.id, input.provider, input.token);
      return reply.code(201).send(created);
    },
  );
}
