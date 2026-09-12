import {
  calendarQuerySchema,
  createTaskFromTextInputSchema,
  createTaskInputSchema,
  listTasksQuerySchema,
  patchTaskInputSchema,
  reorderTasksInputSchema,
  uncompleteTaskInputSchema,
  uuidSchema,
} from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { limitLlm } from '../plugins/rate-limit.js';
import {
  calendar,
  completeTask,
  createTask,
  createTaskFromText,
  deleteTask,
  getTask,
  getTaskDraft,
  listTasks,
  patchTask,
  reorderTasks,
  requestTaskDraft,
  restoreTask,
  taskCounts,
  uncompleteTask,
} from './tasks.service.js';

const idParams = z.object({ id: uuidSchema });

export function registerTaskRoutes(app: FastifyInstance): void {
  app.get('/api/v1/tasks/calendar', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return calendar(user.id, calendarQuerySchema.parse(req.query));
  });

  app.put('/api/v1/tasks/reorder', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    await reorderTasks(user.id, reorderTasksInputSchema.parse(req.body));
    return reply.code(204).send();
  });

  app.get('/api/v1/tasks/counts', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return taskCounts(user.id);
  });

  app.get('/api/v1/tasks', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listTasks(user.id, listTasksQuerySchema.parse(req.query));
  });

  app.post('/api/v1/tasks/from-text', { preHandler: [requireAuth, limitLlm] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const created = await createTaskFromText(user.id, createTaskFromTextInputSchema.parse(req.body));
    return reply.code(201).send(created);
  });

  app.post('/api/v1/tasks', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const created = await createTask(user.id, createTaskInputSchema.parse(req.body));
    return reply.code(201).send(created);
  });

  app.get('/api/v1/tasks/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return getTask(user.id, id);
  });

  app.patch('/api/v1/tasks/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return patchTask(user.id, id, patchTaskInputSchema.parse(req.body));
  });

  app.delete('/api/v1/tasks/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    await deleteTask(user.id, id);
    return reply.code(204).send();
  });

  /** Read-only draft job status for a delegable task. Does not enqueue. */
  app.get('/api/v1/tasks/:id/draft', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return getTaskDraft(user.id, id);
  });

  /** Ask the agent to draft an execution plan for a delegable task (idempotent). */
  app.post('/api/v1/tasks/:id/draft', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    const result = await requestTaskDraft(user.id, id);
    return reply.code(result.status === 'queued' ? 202 : 200).send(result);
  });

  app.post('/api/v1/tasks/:id/complete', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return completeTask(user.id, id);
  });

  app.post('/api/v1/tasks/:id/uncomplete', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return uncompleteTask(user.id, id, uncompleteTaskInputSchema.parse(req.body));
  });

  app.post('/api/v1/tasks/:id/restore', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return restoreTask(user.id, id);
  });
}
