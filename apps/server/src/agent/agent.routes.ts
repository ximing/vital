import type { FastifyInstance } from 'fastify';
import {
  actionFeedbackInputSchema,
  agentActionIdParamsSchema,
  agentActionsQuerySchema,
  agentMemoryIdParamsSchema,
  agentMetricsQuerySchema,
  agentUsageQuerySchema,
  createAgentMemorySchema,
  patchAgentMemorySchema,
} from '@vital/dto';
import { getUserEntity } from '../auth/auth.service.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { applyActionFeedback, listAgentActions } from './actions.service.js';
import { agentAdoptionDaily } from './metrics.service.js';
import {
  createAgentMemory,
  deleteAgentMemory,
  listAgentMemory,
  patchAgentMemory,
} from './memory.service.js';
import { listExecutions } from './executions.service.js';
import { dailyUsage } from './usage.service.js';

export function registerAgentRoutes(app: FastifyInstance): void {
  app.get('/api/v1/agent/executions', { preHandler: [requireAuth] }, async (req) => {
    if (!req.user) throw AppError.of(401, 'INVALID_TOKEN');
    return listExecutions(req.user.id, agentUsageQuerySchema.parse(req.query).days);
  });
  app.get('/api/v1/agent/actions', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listAgentActions(user.id, agentActionsQuerySchema.parse(req.query));
  });

  app.get('/api/v1/agent/usage', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { days } = agentUsageQuerySchema.parse(req.query);
    const entity = await getUserEntity(user.id);
    return dailyUsage(user.id, days, entity.timezone);
  });

  app.get('/api/v1/agent/metrics', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { days } = agentMetricsQuerySchema.parse(req.query);
    const entity = await getUserEntity(user.id);
    return agentAdoptionDaily(user.id, days, entity.timezone);
  });

  app.post('/api/v1/agent/actions/:id/feedback', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = agentActionIdParamsSchema.parse(req.params);
    return applyActionFeedback(user.id, id, actionFeedbackInputSchema.parse(req.body));
  });

  app.get('/api/v1/agent/memory', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listAgentMemory(user.id);
  });

  app.post('/api/v1/agent/memory', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const created = await createAgentMemory(user.id, createAgentMemorySchema.parse(req.body));
    return reply.code(201).send(created);
  });

  app.patch('/api/v1/agent/memory/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = agentMemoryIdParamsSchema.parse(req.params);
    return patchAgentMemory(user.id, id, patchAgentMemorySchema.parse(req.body));
  });

  app.delete('/api/v1/agent/memory/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = agentMemoryIdParamsSchema.parse(req.params);
    await deleteAgentMemory(user.id, id);
    return reply.code(204).send();
  });
}
