import type { FastifyInstance } from 'fastify';
import { createEnergyLogSchema, energyLogQuerySchema } from '@vital/dto';
import { AppError } from '../errors.js';
import { getUserEntity } from '../auth/auth.service.js';
import { requireAuth } from '../plugins/auth.js';
import { createEnergyLog, listEnergyLogs } from './energy.service.js';

export function registerEnergyLogRoutes(app: FastifyInstance): void {
  app.get('/api/v1/energy-logs', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const entity = await getUserEntity(user.id);
    const query = energyLogQuerySchema.parse(req.query);
    return listEnergyLogs(user.id, entity.timezone, query);
  });

  app.post('/api/v1/energy-logs', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    await getUserEntity(user.id);
    const created = await createEnergyLog(user.id, createEnergyLogSchema.parse(req.body));
    return reply.code(201).send(created);
  });
}
