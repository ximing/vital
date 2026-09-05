import { createTagInputSchema, patchTagInputSchema, uuidSchema } from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { createTag, deleteTag, listTags, patchTag } from './tags.service.js';

const idParams = z.object({ id: uuidSchema });

export function registerTagRoutes(app: FastifyInstance): void {
  app.get('/api/v1/tags', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listTags(user.id);
  });

  app.post('/api/v1/tags', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const created = await createTag(user.id, createTagInputSchema.parse(req.body));
    return reply.code(201).send(created);
  });

  app.patch('/api/v1/tags/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return patchTag(user.id, id, patchTagInputSchema.parse(req.body));
  });

  app.delete('/api/v1/tags/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    await deleteTag(user.id, id);
    return reply.code(204).send();
  });
}
