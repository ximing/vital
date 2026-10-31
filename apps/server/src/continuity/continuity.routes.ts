import type { FastifyInstance } from 'fastify';
import {
  continuityActivateInputSchema,
  continuityDependencyIdParamsSchema,
  continuityDraftInputSchema,
  continuityEvidenceCreateSchema,
  continuityEvidenceIdParamsSchema,
  continuityEvidencePatchSchema,
  continuityExperimentCreateSchema,
  continuityExperimentIdParamsSchema,
  continuityFeedbackInputSchema,
  continuityInterventionIdParamsSchema,
  continuityPauseInputSchema,
  continuityProtectedBlockIdParamsSchema,
  continuitySnoozeInputSchema,
  continuityVersionInputSchema,
  createContinuityDependencySchema,
  createContinuityProtectedBlockSchema,
  outcomeIdParamsSchema,
  patchContinuityDependencySchema,
  patchContinuityProtectedBlockSchema,
  putContinuitySettingsSchema,
} from '@vital/dto';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import {
  activateContinuity,
  endContinuity,
  getContinuity,
  getContinuitySettings,
  pauseContinuity,
  putContinuityDraft,
  putContinuitySettings,
  resumeContinuity,
} from './continuity.service.js';
import {
  createContinuityDependency,
  deleteContinuityDependency,
  listContinuityDependencies,
  patchContinuityDependency,
} from './dependencies.service.js';
import {
  createContinuityEvidence,
  patchContinuityEvidence,
  retractContinuityEvidence,
} from './evidence.service.js';
import {
  completeContinuityExperiment,
  createContinuityExperiment,
  getContinuityExperiment,
} from './experiments.service.js';
import {
  feedbackContinuityIntervention,
  listContinuityInterventions,
  markContinuityInterventionSeen,
  snoozeContinuityIntervention,
} from './interventions.service.js';
import {
  createContinuityProtectedBlock,
  deleteContinuityProtectedBlock,
  listContinuityProtectedBlocks,
  patchContinuityProtectedBlock,
} from './protected-blocks.service.js';

function body<T>(schema: { parse: (value: unknown) => T }, raw: unknown): T {
  return schema.parse(raw ?? {});
}

export function registerContinuityRoutes(app: FastifyInstance): void {
  /** Continuity contract for a thread. Missing row is `{ hosted: false, contract: null }`. */
  app.get('/api/v1/outcomes/:id/continuity', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return getContinuity(user.id, id);
  });

  /** Create or update a continuity draft. Does not create tasks. */
  app.put('/api/v1/outcomes/:id/continuity', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return putContinuityDraft(user.id, id, body(continuityDraftInputSchema, req.body));
  });

  /** Activate hosting. Same outcome or same idempotencyKey returns the existing row. */
  app.post('/api/v1/outcomes/:id/continuity/activate', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return activateContinuity(user.id, id, body(continuityActivateInputSchema, req.body));
  });

  /** Pause a contract. Available even when CONTINUITY_ENABLED is off. */
  app.post('/api/v1/outcomes/:id/continuity/pause', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return pauseContinuity(user.id, id, body(continuityPauseInputSchema, req.body));
  });

  app.post('/api/v1/outcomes/:id/continuity/resume', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return resumeContinuity(user.id, id, body(continuityVersionInputSchema, req.body));
  });

  app.post('/api/v1/outcomes/:id/continuity/end', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return endContinuity(user.id, id, body(continuityVersionInputSchema, req.body));
  });

  app.get('/api/v1/continuity/settings', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return getContinuitySettings(user.id);
  });

  app.put('/api/v1/continuity/settings', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return putContinuitySettings(user.id, putContinuitySettingsSchema.parse(req.body ?? {}));
  });

  /** Open or snoozed stall candidates for the today page. Flag off still reads. */
  app.get('/api/v1/continuity/interventions', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listContinuityInterventions(user.id);
  });

  app.post('/api/v1/continuity/interventions/:id/seen', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityInterventionIdParamsSchema.parse(req.params);
    return markContinuityInterventionSeen(user.id, id);
  });

  app.post('/api/v1/continuity/interventions/:id/snooze', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityInterventionIdParamsSchema.parse(req.params);
    return snoozeContinuityIntervention(user.id, id, body(continuitySnoozeInputSchema, req.body));
  });

  app.post('/api/v1/continuity/interventions/:id/feedback', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityInterventionIdParamsSchema.parse(req.params);
    return feedbackContinuityIntervention(user.id, id, body(continuityFeedbackInputSchema, req.body));
  });

  /** User self-report of progress. Does not create tasks. */
  app.post('/api/v1/continuity/evidence', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return createContinuityEvidence(user.id, body(continuityEvidenceCreateSchema, req.body));
  });

  app.patch('/api/v1/continuity/evidence/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityEvidenceIdParamsSchema.parse(req.params);
    return patchContinuityEvidence(user.id, id, body(continuityEvidencePatchSchema, req.body));
  });

  app.delete('/api/v1/continuity/evidence/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityEvidenceIdParamsSchema.parse(req.params);
    return retractContinuityEvidence(user.id, id);
  });

  /** Start a single-contract correction experiment. Rejects a second active row. */
  app.post('/api/v1/continuity/experiments', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return createContinuityExperiment(user.id, body(continuityExperimentCreateSchema, req.body));
  });

  app.get('/api/v1/continuity/experiments/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityExperimentIdParamsSchema.parse(req.params);
    return getContinuityExperiment(user.id, id);
  });

  app.post('/api/v1/continuity/experiments/:id/complete', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityExperimentIdParamsSchema.parse(req.params);
    return completeContinuityExperiment(user.id, id);
  });

  /** Work dependencies for a hosted thread. Cross-user 404. */
  app.get('/api/v1/outcomes/:id/continuity/dependencies', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return listContinuityDependencies(user.id, id);
  });

  /** Add an internal task/thread or an external one-line condition. Enqueues recompute. */
  app.post('/api/v1/outcomes/:id/continuity/dependencies', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = outcomeIdParamsSchema.parse(req.params);
    return createContinuityDependency(user.id, id, body(createContinuityDependencySchema, req.body));
  });

  /** Mark an external condition resolved or still waiting. */
  app.patch('/api/v1/continuity/dependencies/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityDependencyIdParamsSchema.parse(req.params);
    return patchContinuityDependency(user.id, id, body(patchContinuityDependencySchema, req.body));
  });

  app.delete('/api/v1/continuity/dependencies/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityDependencyIdParamsSchema.parse(req.params);
    await deleteContinuityDependency(user.id, id);
    return { ok: true as const };
  });

  /** User-declared protected time. Occupies work windows; all-day due tasks do not. */
  app.get('/api/v1/continuity/protected-blocks', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listContinuityProtectedBlocks(user.id);
  });

  app.post('/api/v1/continuity/protected-blocks', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return createContinuityProtectedBlock(user.id, body(createContinuityProtectedBlockSchema, req.body));
  });

  app.patch('/api/v1/continuity/protected-blocks/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityProtectedBlockIdParamsSchema.parse(req.params);
    return patchContinuityProtectedBlock(user.id, id, body(patchContinuityProtectedBlockSchema, req.body));
  });

  app.delete('/api/v1/continuity/protected-blocks/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = continuityProtectedBlockIdParamsSchema.parse(req.params);
    await deleteContinuityProtectedBlock(user.id, id);
    return { ok: true as const };
  });
}
