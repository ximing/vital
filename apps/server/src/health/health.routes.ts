import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { AppError } from '../errors.js';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/api/health', () => ({ status: 'ok' }));

  app.get('/api/v1/health/ready', async () => {
    try {
      await getDb().execute(sql`SELECT 1`);
    } catch {
      throw AppError.of(503, 'INTERNAL_ERROR');
    }
    return { status: 'ok' };
  });
}
