import type { FastifyInstance } from 'fastify';
import {
  explorationConfirmInputSchema,
  explorationGenerateInputSchema,
  explorationProposalIdParamsSchema,
  explorationSelectInputSchema,
  explorationWindowIdParamsSchema,
} from '@vital/dto';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { listExplorationWindows, restExplorationWindow } from './exploration-windows.js';
import {
  confirmProposal,
  generateWindowProposals,
  getExplorationWindowDetail,
  rejectProposal,
  selectProposal,
} from './exploration-verify.js';

export function registerExplorationRoutes(app: FastifyInstance): void {
  /** Upcoming exploration windows (open, rest, and closed that have not ended). */
  app.get('/api/v1/exploration/windows', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return listExplorationWindows(user.id);
  });

  app.get('/api/v1/exploration/windows/:id', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = explorationWindowIdParamsSchema.parse(req.params);
    return getExplorationWindowDetail(user.id, id);
  });

  /** Fill up to three fixture proposals for an open window. */
  app.post('/api/v1/exploration/windows/:id/generate', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = explorationWindowIdParamsSchema.parse(req.params);
    const input = explorationGenerateInputSchema.parse(req.body ?? {});
    return generateWindowProposals(user.id, id, input);
  });

  /** Close this window: no further proposals. Does not reopen on regenerate. */
  app.post('/api/v1/exploration/windows/:id/rest', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = explorationWindowIdParamsSchema.parse(req.params);
    return restExplorationWindow(user.id, id);
  });

  /** Re-verify and move a proposal toward a confirmable draft. */
  app.post('/api/v1/exploration/proposals/:id/select', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = explorationProposalIdParamsSchema.parse(req.params);
    const input = explorationSelectInputSchema.parse(req.body ?? {});
    return selectProposal(user.id, id, input);
  });

  /** Confirm a draft: create one task. Unknown facts require acceptUnknown. */
  app.post('/api/v1/exploration/proposals/:id/confirm', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = explorationProposalIdParamsSchema.parse(req.params);
    const input = explorationConfirmInputSchema.parse(req.body ?? {});
    return confirmProposal(user.id, id, input);
  });

  /** Reject an activity for 90 days (same activityKey + place). */
  app.post('/api/v1/exploration/proposals/:id/reject', { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const { id } = explorationProposalIdParamsSchema.parse(req.params);
    return rejectProposal(user.id, id);
  });
}
