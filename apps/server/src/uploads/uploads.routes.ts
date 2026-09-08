import {
  uploadBindInputSchema,
  uploadCompletePartsInputSchema,
  uploadInitInputSchema,
} from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import {
  abortUpload,
  bindUpload,
  completeMultipartUpload,
  discardUpload,
  initUpload,
  listUploadedParts,
  presignPartUpload,
} from './uploads.service.js';

const idParams = z.object({ id: z.string().uuid() });
const partParams = z.object({
  id: z.string().uuid(),
  partNumber: z.coerce.number().int().positive(),
});

export function registerUploadRoutes(app: FastifyInstance): void {
  app.post('/api/v1/uploads', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const result = await initUpload(user.id, uploadInitInputSchema.parse(req.body));
    return reply.code(201).send(result);
  });

  app.get('/api/v1/uploads/:id/parts', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return listUploadedParts(user.id, id);
  });

  app.post('/api/v1/uploads/:id/parts/:partNumber', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id, partNumber } = partParams.parse(req.params);
    return presignPartUpload(user.id, id, partNumber);
  });

  app.post('/api/v1/uploads/:id/complete', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return completeMultipartUpload(user.id, id, uploadCompletePartsInputSchema.parse(req.body));
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

  app.post('/api/v1/uploads/:id/bind', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return bindUpload(user.id, id, uploadBindInputSchema.parse(req.body));
  });
}
