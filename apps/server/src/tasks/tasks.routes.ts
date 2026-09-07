import {
  calendarQuerySchema,
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
import {
  calendar,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  patchTask,
  reorderTasks,
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
