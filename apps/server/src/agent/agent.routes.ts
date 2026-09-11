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
import { applyActionFeedback, listAgentActions, undoAgentAction } from './actions.service.js';
import { agentAdoptionDaily } from './metrics.service.js';
import {
  createAgentMemory,
  deleteAgentMemory,
  listAgentMemory,
  patchAgentMemory,
} from './memory.service.js';
import { listExecutions } from './executions.service.js';
import { SCHEDULED_CAPABILITIES, cancelAgentSchedule, dispatchAgentSchedule, listAgentSchedule } from './scheduling.js';
import { dailyUsage } from './usage.service.js';
import { limitLlm } from '../plugins/rate-limit.js';

export function registerAgentRoutes(app: FastifyInstance): void {
  for (const [path, capability] of [['cluster', 'outcome.cluster'], ['memory/distill', 'memory.distill']] as const) {
    app.post(`/api/v1/agent/${path}`, { preHandler: [requireAuth, limitLlm] }, async (req, reply) => {
      if (!req.user) throw AppError.of(401, 'INVALID_TOKEN');
      const jobId = await dispatchAgentSchedule(req.user.id, capability, new Date(), true);
      return reply.code(202).send({ status: jobId ? 'queued' : 'disabled', jobId });
    });
  }
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

  app.get('/api/v1/agent/schedule', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listAgentSchedule(user.id);
  });

  app.post('/api/v1/agent/schedule/:capability/cancel', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { capability } = req.params as { capability: string };
    if (!SCHEDULED_CAPABILITIES.includes(capability as (typeof SCHEDULED_CAPABILITIES)[number])) {
      throw AppError.of(404, 'NOT_FOUND');
    }
    return cancelAgentSchedule(user.id, capability as (typeof SCHEDULED_CAPABILITIES)[number]);
  });

  app.post('/api/v1/agent/actions/:id/feedback', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = agentActionIdParamsSchema.parse(req.params);
    return applyActionFeedback(user.id, id, actionFeedbackInputSchema.parse(req.body));
  });

  app.post('/api/v1/agent/actions/:id/undo', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = agentActionIdParamsSchema.parse(req.params);
    return undoAgentAction(user.id, id);
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
