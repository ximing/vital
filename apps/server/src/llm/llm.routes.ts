import type { FastifyInstance } from 'fastify';
import { getUserEntity } from '../auth/auth.service.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { limitLlm } from '../plugins/rate-limit.js';
import { testLlmConnection } from './client.js';

export function registerLlmRoutes(app: FastifyInstance): void {
  app.post('/api/v1/llm/test', { preHandler: [requireAuth, limitLlm] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return testLlmConnection(await getUserEntity(user.id));
  });
}
