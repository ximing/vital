import {
  createListInputSchema,
  patchListInputSchema,
  reorderListsInputSchema,
  uuidSchema,
} from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import {
  createList,
  deleteList,
  listLists,
  patchList,
  reorderLists,
} from './lists.service.js';

const idParams = z.object({ id: uuidSchema });

export function registerListRoutes(app: FastifyInstance): void {
  app.get('/api/v1/lists', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listLists(user.id);
  });

  app.post('/api/v1/lists', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const created = await createList(user.id, createListInputSchema.parse(req.body));
    return reply.code(201).send(created);
  });

  app.put('/api/v1/lists/reorder', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return reorderLists(user.id, reorderListsInputSchema.parse(req.body));
  });

  app.patch('/api/v1/lists/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return patchList(user.id, id, patchListInputSchema.parse(req.body));
  });

  app.delete('/api/v1/lists/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    await deleteList(user.id, id);
    return reply.code(204).send();
  });
}
