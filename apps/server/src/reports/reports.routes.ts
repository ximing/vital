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
import { limitLlm } from '../plugins/rate-limit.js';
import { getReportOverview, getReportReview } from './overview.service.js';
import {
  countReportsByType,
  fillReport,
  getCurrentReport,
  getReport,
  getReportEmbeds,
  listReports,
  patchReport,
  requestReportGenerate,
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
    return getReportOverview(user.id, type, at);
  });

  app.get('/api/v1/reports/current', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { type, at } = currentReportQuerySchema.parse(req.query);
    return getCurrentReport(user.id, type, at);
  });

  app.get('/api/v1/reports/counts', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return countReportsByType(user.id);
  });

  app.get('/api/v1/reports/:id/review', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = reportIdParamsSchema.parse(req.params);
    return getReportReview(user.id, id);
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
    return fillReport(user.id, id, fillReportInputSchema.parse(req.body));
  });

  app.post('/api/v1/reports/:id/generate', { preHandler: [requireAuth, limitLlm] }, async (req, reply) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = reportIdParamsSchema.parse(req.params);
    const result = await requestReportGenerate(user.id, id);
    return reply.code(202).send(result);
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
