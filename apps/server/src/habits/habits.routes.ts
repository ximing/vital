import type { FastifyInstance } from 'fastify';
import { createHabitInputSchema, habitIdParamsSchema, patchHabitInputSchema } from '@vital/dto';
import { AppError } from '../errors.js';
import { getUserEntity } from '../auth/auth.service.js';
import { requireAuth } from '../plugins/auth.js';
import { createHabit, deleteHabit, listHabits, patchHabit } from './habits.service.js';

export function registerHabitRoutes(app: FastifyInstance): void {
  app.get('/api/v1/habits', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const entity = await getUserEntity(user.id);
    return listHabits(user.id, entity.timezone);
  });

  app.post('/api/v1/habits', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return createHabit(user.id, createHabitInputSchema.parse(req.body));
  });

  app.patch('/api/v1/habits/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = habitIdParamsSchema.parse(req.params);
    return patchHabit(user.id, id, patchHabitInputSchema.parse(req.body));
  });

  app.delete('/api/v1/habits/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = habitIdParamsSchema.parse(req.params);
    await deleteHabit(user.id, id);
    return { ok: true };
  });
}
