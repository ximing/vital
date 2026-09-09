import type { FastifyInstance } from 'fastify';
import {
  llmProviderInputSchema,
  patchLlmProviderInputSchema,
  putLlmRoutingSchema,
  testLlmConnectionInputSchema,
} from '@vital/dto';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { limitLlm } from '../plugins/rate-limit.js';
import { llmCatalog } from './pi.js';
import {
  addLlmProvider,
  patchLlmProvider,
  putLlmRouting,
  removeLlmProvider,
  testLlmProvider,
} from './settings.service.js';

const providerIdParamsSchema = z.object({ id: z.string().uuid() });

export function registerLlmRoutes(app: FastifyInstance): void {
  /** Builtin provider catalog for the settings UI (labels + selectable models). */
  app.get('/api/v1/llm/catalog', { preHandler: [requireAuth] }, async () => {
    return { providers: llmCatalog() };
  });

  app.post('/api/v1/llm/providers', { preHandler: [requireAuth, limitLlm] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return addLlmProvider(user.id, llmProviderInputSchema.parse(req.body));
  });

  app.patch('/api/v1/llm/providers/:id', { preHandler: [requireAuth, limitLlm] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = providerIdParamsSchema.parse(req.params);
    return patchLlmProvider(user.id, id, patchLlmProviderInputSchema.parse(req.body));
  });

  app.delete('/api/v1/llm/providers/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = providerIdParamsSchema.parse(req.params);
    return removeLlmProvider(user.id, id);
  });

  app.post(
    '/api/v1/llm/providers/:id/test',
    { preHandler: [requireAuth, limitLlm] },
    async (req) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      const { id } = providerIdParamsSchema.parse(req.params);
      const { model } = testLlmConnectionInputSchema.parse(req.body);
      return testLlmProvider(user.id, id, model);
    },
  );

  app.put('/api/v1/llm/routing', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return putLlmRouting(user.id, putLlmRoutingSchema.parse(req.body).routing);
  });
}
