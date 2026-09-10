import type { FastifyInstance } from 'fastify';
import {
  createOutcomeInputSchema,
  listOutcomesQuerySchema,
  outcomeIdParamsSchema,
  patchOutcomeInputSchema,
} from '@vital/dto';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { limitLlm } from '../plugins/rate-limit.js';
import { getUserEntity } from '../auth/auth.service.js';
import { getDb } from '../db/index.js';
import { enqueueOutcomeRefresh } from '../agent/jobs.js';
import { getOwnedOutcomeOr404 } from './shared.js';
import {
  closeOutcome,
  createOutcome,
  getOutcomeDetail,
  getTodayDashboard,
  listOutcomes,
  patchOutcome,
  reopenOutcome,
  undoOutcome,
} from './outcomes.service.js';

export function registerOutcomeRoutes(app: FastifyInstance): void {
  app.get('/api/v1/today', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const entity = await getUserEntity(user.id);
    return getTodayDashboard(user.id, entity.timezone);
  });

  app.get('/api/v1/outcomes', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listOutcomes(user.id, listOutcomesQuerySchema.parse(req.query));
  });

  app.post('/api/v1/outcomes', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const created = await createOutcome(user.id, createOutcomeInputSchema.parse(req.body));
    return created;
  });

  app.patch('/api/v1/outcomes/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return patchOutcome(user.id, id, patchOutcomeInputSchema.parse(req.body));
  });

  /** Thread drill-down: outcome + its tasks, materials and agent timeline. */
  app.get('/api/v1/outcomes/:id/detail', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return getOutcomeDetail(user.id, id);
  });

  app.post('/api/v1/outcomes/:id/close', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return closeOutcome(user.id, id);
  });

  app.post('/api/v1/outcomes/:id/reopen', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return reopenOutcome(user.id, id);
  });

  app.post('/api/v1/outcomes/:id/undo', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    await undoOutcome(user.id, id);
    return { ok: true };
  });

  /** Manual agent re-run: enqueue + mark pending, 202 (worker picks it up). */
  app.post(
    '/api/v1/outcomes/:id/refresh',
    { preHandler: [requireAuth, limitLlm] },
    async (req, reply) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      const { id } = outcomeIdParamsSchema.parse(req.params);
      await getOwnedOutcomeOr404(user.id, id);
      await enqueueOutcomeRefresh(getDb(), user.id, id, new Date(), { delayMs: 0, manual: true });
      return reply.code(202).send({ ok: true });
    },
  );
}
