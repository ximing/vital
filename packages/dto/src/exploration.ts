import { z } from 'zod';
import { uuidSchema } from './lists.js';

/** Public-holiday region code. Never inferred from holiday_calendar's table default. */
export const explorationRegionSchema = z
  .string()
  .trim()
  .min(2)
  .max(8)
  .regex(/^[A-Za-z]{2,8}$/, { message: 'INVALID_REGION' })
  .transform((value) => value.toUpperCase());
export type ExplorationRegion = z.infer<typeof explorationRegionSchema>;

export const explorationWindowStatusSchema = z.enum(['open', 'closed', 'rest']);
export type ExplorationWindowStatus = z.infer<typeof explorationWindowStatusSchema>;

export const explorationProposalStatusSchema = z.enum([
  'proposed',
  'selected',
  'verification_pending',
  'draft_ready',
  'confirmed',
  'completed',
  'canceled',
]);
export type ExplorationProposalStatus = z.infer<typeof explorationProposalStatusSchema>;

export const explorationDirectionSchema = z.enum(['familiar', 'new', 'low_energy']);
export type ExplorationDirection = z.infer<typeof explorationDirectionSchema>;

export const explorationFactStatusSchema = z.enum(['verified', 'unknown', 'changed']);
export type ExplorationFactStatus = z.infer<typeof explorationFactStatusSchema>;

export const explorationVerifyStageSchema = z.enum(['initial', 'select', 'decision', 'departure']);
export type ExplorationVerifyStage = z.infer<typeof explorationVerifyStageSchema>;

export const explorationWindowIdParamsSchema = z.object({
  id: uuidSchema,
});
export type ExplorationWindowIdParams = z.infer<typeof explorationWindowIdParamsSchema>;

export const explorationProposalIdParamsSchema = z.object({
  id: uuidSchema,
});
export type ExplorationProposalIdParams = z.infer<typeof explorationProposalIdParamsSchema>;

const explorationIdempotencyKeySchema = z.string().trim().min(1).max(128);

export const explorationGenerateInputSchema = z.object({
  place: z.string().trim().min(1).max(128).nullable().optional(),
  reRequest: z.boolean().optional(),
});
export type ExplorationGenerateInput = z.infer<typeof explorationGenerateInputSchema>;

export const explorationSelectInputSchema = z.object({
  place: z.string().trim().min(1).max(128).nullable().optional(),
  departureAt: z.string().datetime({ offset: true }).optional(),
});
export type ExplorationSelectInput = z.infer<typeof explorationSelectInputSchema>;

export const explorationConfirmInputSchema = z.object({
  acceptUnknown: z.boolean().optional(),
  idempotencyKey: explorationIdempotencyKeySchema.optional(),
  place: z.string().trim().min(1).max(128).nullable().optional(),
  departureAt: z.string().datetime({ offset: true }).optional(),
});
export type ExplorationConfirmInput = z.infer<typeof explorationConfirmInputSchema>;

export const explorationProposalContentSchema = z.object({
  title: z.string(),
  reason: z.string(),
  experience: z.string(),
  timeCost: z.string(),
  moneyRange: z.string(),
  companions: z.string(),
  source: z.string(),
  fetchedAt: z.string(),
  cancelPolicy: z.string(),
  alternative: z.string(),
  direction: explorationDirectionSchema,
  leaveFreeTime: z.string(),
});
export type ExplorationProposalContent = z.infer<typeof explorationProposalContentSchema>;

export interface ExplorationWindow {
  id: string;
  windowKey: string;
  startDate: string;
  endDate: string;
  timezone: string;
  region: string | null;
  calendarVersion: string;
  status: ExplorationWindowStatus;
  closedReason: string | null;
  generatedAt: string;
}

export interface ExplorationWindowList {
  items: ExplorationWindow[];
}

export interface ExplorationVerification {
  id: string;
  proposalId: string;
  stage: ExplorationVerifyStage | string;
  field: string;
  value: unknown;
  url: string | null;
  fetchedAt: string | null;
  validUntil: string | null;
  status: ExplorationFactStatus;
  diff: unknown;
  createdAt: string;
}

export interface ExplorationProposal {
  id: string;
  windowId: string;
  activityKey: string;
  status: ExplorationProposalStatus;
  interestReason: string | null;
  content: ExplorationProposalContent;
  planId: string | null;
  taskId: string | null;
  place: string | null;
  decisionDeadline: string | null;
  departureAt: string | null;
  nextVerifyAt: string | null;
  rejectedAt: string | null;
  version: number;
  createdAt: string;
  verifications: ExplorationVerification[];
}

export interface ExplorationWindowDetail extends ExplorationWindow {
  proposals: ExplorationProposal[];
  /** One question only when city is missing. Null when proposals are location-free enough. */
  cityPrompt: string | null;
}
