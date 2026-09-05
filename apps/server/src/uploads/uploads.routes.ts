import { uploadPresignInputSchema } from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import {
  abortUpload,
  completeUpload,
  discardUpload,
  presignUpload,
  resolveAccessUrl,
} from './uploads.service.js';

const idParams = z.object({ id: z.string().uuid() });

export function registerUploadRoutes(app: FastifyInstance): void {
  app.post('/api/v1/uploads/presign', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const body = uploadPresignInputSchema.parse(req.body);
    const result = await presignUpload(user.id, body);
    return reply.code(201).send(result);
  });

  app.post('/api/v1/uploads/:id/complete', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return completeUpload(user.id, id);
  });

  app.post('/api/v1/uploads/:id/abort', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    await abortUpload(user.id, id);
    return reply.code(204).send();
  });

  app.delete('/api/v1/uploads/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    await discardUpload(user.id, id);
    return reply.code(204).send();
  });

  app.get('/api/v1/uploads/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    const url = await resolveAccessUrl(user.id, id);
    return reply.header('Cache-Control', 'private, max-age=300').redirect(url, 302);
  });
}
