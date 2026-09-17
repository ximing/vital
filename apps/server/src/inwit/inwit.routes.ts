import { inwitConfigInputSchema } from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { limitInwit } from '../plugins/rate-limit.js';
import { getInwitConfig, putInwitConfig, testInwitConfig } from './inwit.service.js';

export function registerInwitRoutes(app: FastifyInstance): void {
  app.get('/api/v1/integrations/inwit', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return getInwitConfig(user.id);
  });

  app.put('/api/v1/integrations/inwit', { preHandler: [requireAuth, limitInwit] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return putInwitConfig(user.id, inwitConfigInputSchema.parse(req.body));
  });

  app.post(
    '/api/v1/integrations/inwit/test',
    { preHandler: [requireAuth, limitInwit] },
    async (req) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      return testInwitConfig(user.id);
    },
  );
}
