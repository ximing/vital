import {
  convertInboxInputSchema,
  createInboxInputSchema,
  extractInboxInputSchema,
  idempotencyKeySchema,
  INBOX_JSON_BODY_LIMIT_BYTES,
  listInboxQuerySchema,
  patchInboxAssetsInputSchema,
  patchInboxInputSchema,
  uuidSchema,
} from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { extractUrl } from '../extract/extract.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { limitInbox } from '../plugins/rate-limit.js';
import {
  convertInbox,
  createInbox,
  deleteInbox,
  getInbox,
  listInbox,
  patchInbox,
  patchInboxAssets,
} from './inbox.service.js';

const idParams = z.object({ id: uuidSchema });

function idempotencyHeader(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === '') return undefined;
  return idempotencyKeySchema.parse(value);
}

export function registerInboxRoutes(app: FastifyInstance): void {
  app.post(
    '/api/v1/inbox/extract',
    { preHandler: [requireAuth, limitInbox] },
    async (req) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      const body = extractInboxInputSchema.parse(req.body);
      return extractUrl(body.url);
    },
  );

  app.get('/api/v1/inbox', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listInbox(user.id, listInboxQuerySchema.parse(req.query));
  });

  app.post(
    '/api/v1/inbox',
    { preHandler: [requireAuth, limitInbox], bodyLimit: INBOX_JSON_BODY_LIMIT_BYTES },
    async (req, reply) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      const created = await createInbox(
        user.id,
        createInboxInputSchema.parse(req.body),
        idempotencyHeader(req.headers['idempotency-key']),
      );
      return reply.code(created.status).send(created.item);
    },
  );

  app.get('/api/v1/inbox/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return getInbox(user.id, id);
  });

  app.patch(
    '/api/v1/inbox/:id',
    { preHandler: [requireAuth], bodyLimit: INBOX_JSON_BODY_LIMIT_BYTES },
    async (req) => {
      const user = req.user;
      if (!user) throw AppError.of(401, 'INVALID_TOKEN');
      const { id } = idParams.parse(req.params);
      return patchInbox(user.id, id, patchInboxInputSchema.parse(req.body));
    },
  );

  app.patch('/api/v1/inbox/:id/assets', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    return patchInboxAssets(user.id, id, patchInboxAssetsInputSchema.parse(req.body));
  });

  app.delete('/api/v1/inbox/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    await deleteInbox(user.id, id);
    return reply.code(204).send();
  });

  app.post('/api/v1/inbox/:id/convert', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = idParams.parse(req.params);
    const converted = await convertInbox(user.id, id, convertInboxInputSchema.parse(req.body ?? {}));
    return reply.code(converted.created ? 201 : 200).send(converted.result);
  });
}
