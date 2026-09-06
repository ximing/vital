import {
  currentReportQuerySchema,
  fillReportInputSchema,
  getReportQuerySchema,
  listReportsQuerySchema,
  patchReportInputSchema,
  reportIdParamsSchema,
  reportOverviewQuerySchema,
} from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { getReportOverview, getReportReview } from './overview.service.js';
import {
  fillReport,
  getCurrentReport,
  getReport,
  getReportEmbeds,
  listReports,
  patchReport,
} from './reports.service.js';

export function registerReportRoutes(app: FastifyInstance): void {
  app.get('/api/v1/reports', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listReports(user.id, listReportsQuerySchema.parse(req.query));
  });

  app.get('/api/v1/reports/overview', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { type, at } = reportOverviewQuerySchema.parse(req.query);
    return getReportOverview(user, type, at);
  });

  app.get('/api/v1/reports/current', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { type, at } = currentReportQuerySchema.parse(req.query);
    return getCurrentReport(user, type, at);
  });

  app.get('/api/v1/reports/:id/review', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = reportIdParamsSchema.parse(req.params);
    return getReportReview(user, id);
  });

  app.get('/api/v1/reports/:id/embeds', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = reportIdParamsSchema.parse(req.params);
    return getReportEmbeds(user.id, id);
  });

  app.post('/api/v1/reports/:id/fill', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = reportIdParamsSchema.parse(req.params);
    return fillReport(user, id, fillReportInputSchema.parse(req.body));
  });

  app.get('/api/v1/reports/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = reportIdParamsSchema.parse(req.params);
    return getReport(user.id, id, getReportQuerySchema.parse(req.query));
  });

  app.patch('/api/v1/reports/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = reportIdParamsSchema.parse(req.params);
    return patchReport(user.id, id, patchReportInputSchema.parse(req.body));
  });
}
