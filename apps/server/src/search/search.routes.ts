import { searchInputSchema } from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { limitSearch } from '../plugins/rate-limit.js';
import { searchTasks } from './search.service.js';

export function registerSearchRoutes(app: FastifyInstance): void {
  app.post('/api/v1/search', { preHandler: [requireAuth, limitSearch] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return searchTasks(user.id, searchInputSchema.parse(req.body));
  });
}
