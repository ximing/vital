import type { FastifyInstance } from 'fastify';
import {
  createDayInputSchema,
  dayCalendarMetaQuerySchema,
  dayIdParamsSchema,
  patchDayInputSchema,
} from '@vital/dto';
import { AppError } from '../errors.js';
import { getUserEntity } from '../auth/auth.service.js';
import { requireAuth } from '../plugins/auth.js';
import {
  createDay,
  deleteDay,
  getDay,
  getDayCalendarMeta,
  listDayCatalog,
  listDays,
  patchDay,
} from './days.service.js';

export function registerDayRoutes(app: FastifyInstance): void {
  app.get('/api/v1/days', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const entity = await getUserEntity(user.id);
    const items = await listDays(user.id, entity.timezone);
    return { items };
  });

  app.get('/api/v1/days/catalog', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const entity = await getUserEntity(user.id);
    return listDayCatalog(user.id, entity.timezone);
  });

  app.get('/api/v1/days/meta', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    await getUserEntity(user.id);
    const { year } = dayCalendarMetaQuerySchema.parse(req.query);
    return getDayCalendarMeta(year);
  });

  app.get('/api/v1/days/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = dayIdParamsSchema.parse(req.params);
    const entity = await getUserEntity(user.id);
    return getDay(user.id, id, entity.timezone);
  });

  app.post('/api/v1/days', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const entity = await getUserEntity(user.id);
    const created = await createDay(user.id, createDayInputSchema.parse(req.body), entity.timezone);
    return reply.code(201).send(created);
  });

  app.patch('/api/v1/days/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = dayIdParamsSchema.parse(req.params);
    const entity = await getUserEntity(user.id);
    return patchDay(user.id, id, patchDayInputSchema.parse(req.body), entity.timezone);
  });

  app.delete('/api/v1/days/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = dayIdParamsSchema.parse(req.params);
    await deleteDay(user.id, id);
    return { ok: true };
  });
}
