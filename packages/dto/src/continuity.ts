import { z } from 'zod';
import { ianaTimezoneSchema, weekStartsOnSchema } from './auth.js';
import { explorationRegionSchema } from './exploration.js';
import { uuidSchema } from './lists.js';

const hmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'INVALID_HM' });

export const continuityLifecycleSchema = z.enum(['draft', 'active', 'paused', 'ended']);
export type ContinuityLifecycle = z.infer<typeof continuityLifecycleSchema>;

export const continuityJudgementSchema = z.enum(['on_track', 'watching', 'needs_adjust', 'waiting']);
export type ContinuityJudgement = z.infer<typeof continuityJudgementSchema>;

export const continuityTimedSlotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startHm: hmSchema,
  durationMin: z.number().int().min(1).max(480),
});
export type ContinuityTimedSlot = z.infer<typeof continuityTimedSlotSchema>;

export const continuityCadenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('timed'),
    slots: z.array(continuityTimedSlotSchema).min(1).max(14),
    graceHours: z.number().int().min(0).max(72),
  }),
  z.object({
    kind: z.literal('weekly_count'),
    count: z.number().int().min(1).max(14),
    durationMin: z.number().int().min(1).max(480),
    graceHours: z.number().int().min(0).max(72),
  }),
]);
export type ContinuityCadence = z.infer<typeof continuityCadenceSchema>;

export const continuityMinActionSchema = z.object({
  title: z.string().trim().max(120),
  durationMin: z.number().int().min(1).max(480),
  completionStandard: z.string().trim().max(500),
});
export type ContinuityMinAction = z.infer<typeof continuityMinActionSchema>;

export const continuityAuthorizationSchema = z.object({
  readVital: z.boolean(),
  prepareMaterials: z.boolean(),
  generateDrafts: z.boolean(),
  externalSearch: z.boolean(),
});
export type ContinuityAuthorization = z.infer<typeof continuityAuthorizationSchema>;

export const DEFAULT_CONTINUITY_CADENCE: ContinuityCadence = {
  kind: 'weekly_count',
  count: 2,
  durationMin: 20,
  graceHours: 12,
};

export const DEFAULT_CONTINUITY_AUTHORIZATION: ContinuityAuthorization = {
  readVital: true,
  prepareMaterials: true,
  generateDrafts: true,
  externalSearch: false,
};

const expectedVersionSchema = z.number().int().min(0);
const idempotencyKeySchema = z.string().trim().min(1).max(128);

export const continuityDraftInputSchema = z.object({
  meaning: z.string().max(4000).optional(),
  stageGoal: z.string().max(4000).optional(),
  completionCriteria: z.array(z.string().max(500)).max(20).optional(),
  cadence: continuityCadenceSchema.optional(),
  timezone: ianaTimezoneSchema.optional(),
  weekStartsOn: weekStartsOnSchema.optional(),
  minAction: continuityMinActionSchema.optional(),
  evidenceBindings: z.array(z.unknown()).max(50).optional(),
  actionableWindows: z.array(z.unknown()).max(50).optional(),
  authorization: continuityAuthorizationSchema.optional(),
  concernRefs: z.array(z.unknown()).max(50).optional(),
  expectedVersion: expectedVersionSchema.optional(),
  idempotencyKey: idempotencyKeySchema.optional(),
});
export type ContinuityDraftInput = z.infer<typeof continuityDraftInputSchema>;

export const continuityActivateInputSchema = continuityDraftInputSchema;
export type ContinuityActivateInput = ContinuityDraftInput;

export const continuityPauseInputSchema = z.object({
  until: z.string().datetime({ offset: true }).optional(),
  expectedVersion: expectedVersionSchema.optional(),
});
export type ContinuityPauseInput = z.infer<typeof continuityPauseInputSchema>;

export const continuityVersionInputSchema = z.object({
  expectedVersion: expectedVersionSchema.optional(),
});
export type ContinuityVersionInput = z.infer<typeof continuityVersionInputSchema>;

export const putContinuitySettingsSchema = z.object({
  explorationWeekend: z.boolean().optional(),
  explorationHoliday: z.boolean().optional(),
  region: explorationRegionSchema.nullable().optional(),
  externalSearch: z.boolean().optional(),
  dailyPushLimit: z.number().int().min(1).max(5).optional(),
  weeklyPushLimit: z.number().int().min(1).max(14).optional(),
  defaultCadence: continuityCadenceSchema.nullable().optional(),
});
export type PutContinuitySettingsInput = z.infer<typeof putContinuitySettingsSchema>;

export interface ContinuityContractSummary {
  id: string;
  outcomeId: string;
  lifecycle: ContinuityLifecycle;
  judgement: ContinuityJudgement | null;
  currentRevision: number;
  authorizationVersion: number;
  factsVersion: number;
  nextCheckAt: string | null;
  pausedUntil: string | null;
  inAppOnlyUntil: string | null;
  unansweredStreak: number;
  meaning: string;
  stageGoal: string;
  completionCriteria: string[];
  cadence: ContinuityCadence;
  timezone: string;
  weekStartsOn: 0 | 1;
  minAction: ContinuityMinAction;
  evidenceBindings: unknown[];
  actionableWindows: unknown[];
  authorization: ContinuityAuthorization;
  concernRefs: unknown[];
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContinuityGetResponse {
  hosted: boolean;
  contract: ContinuityContractSummary | null;
}

export interface ContinuitySettings {
  explorationWeekend: boolean;
  explorationHoliday: boolean;
  region: string | null;
  externalSearch: boolean;
  dailyPushLimit: number;
  weeklyPushLimit: number;
  defaultCadence: ContinuityCadence | null;
}

export const continuityInterventionKindSchema = z.enum([
  'stall_adjust',
  'work_risk',
  'explore',
  'experiment_review',
]);
export type ContinuityInterventionKind = z.infer<typeof continuityInterventionKindSchema>;

export const continuityInterventionStatusSchema = z.enum([
  'open',
  'snoozed',
  'accepted',
  'dismissed',
  'resolved',
  'expired',
  'withdrawn',
]);
export type ContinuityInterventionStatus = z.infer<typeof continuityInterventionStatusSchema>;

export const continuityExposureSurfaceSchema = z.enum([
  'today',
  'morning_brief',
  'evening_digest',
  'weekly',
  'push',
]);
export type ContinuityExposureSurface = z.infer<typeof continuityExposureSurfaceSchema>;

export const continuitySecondaryActionSchema = z.object({
  kind: z.string().trim().min(1).max(32),
  title: z.string().trim().max(120),
});
export type ContinuitySecondaryAction = z.infer<typeof continuitySecondaryActionSchema>;

export const continuityInterventionContentSchema = z.object({
  facts: z.array(z.string()).max(20),
  whyNow: z.string().max(2000),
  primaryAction: continuityMinActionSchema,
  secondaryActions: z.array(continuitySecondaryActionSchema).max(10),
});
export type ContinuityInterventionContent = z.infer<typeof continuityInterventionContentSchema>;

export const continuityInterventionIdParamsSchema = z.object({
  id: uuidSchema,
});
export type ContinuityInterventionIdParams = z.infer<typeof continuityInterventionIdParamsSchema>;

export const continuitySnoozeInputSchema = z.object({
  until: z.string().datetime({ offset: true }).optional(),
});
export type ContinuitySnoozeInput = z.infer<typeof continuitySnoozeInputSchema>;

export const continuityFeedbackKindSchema = z.enum(['done', 'adjust', 'dismiss', 'pause']);
export type ContinuityFeedbackKind = z.infer<typeof continuityFeedbackKindSchema>;

export const continuityFeedbackInputSchema = z.object({
  kind: continuityFeedbackKindSchema,
  body: z.string().max(4000).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  cadence: continuityCadenceSchema.optional(),
  minAction: continuityMinActionSchema.optional(),
  hypothesis: z.string().max(4000).optional(),
});
export type ContinuityFeedbackInput = z.infer<typeof continuityFeedbackInputSchema>;

export const continuityEvidenceCreateSchema = z.object({
  contractId: uuidSchema,
  body: z.string().max(4000).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: idempotencyKeySchema.optional(),
});
export type ContinuityEvidenceCreateInput = z.infer<typeof continuityEvidenceCreateSchema>;

export const continuityEvidencePatchSchema = z
  .object({
    body: z.string().max(4000).optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((value) => value.body !== undefined || value.occurredAt !== undefined, {
    message: 'at least one field required',
  });
export type ContinuityEvidencePatchInput = z.infer<typeof continuityEvidencePatchSchema>;

export const continuityEvidenceIdParamsSchema = z.object({
  id: uuidSchema,
});
export type ContinuityEvidenceIdParams = z.infer<typeof continuityEvidenceIdParamsSchema>;

export interface ContinuityEvidence {
  id: string;
  contractId: string | null;
  sourceType: 'self_report';
  actor: 'user';
  occurredAt: string;
  recordedAt: string;
  body: string | null;
  retractedAt: string | null;
  createdAt: string;
}

export const continuityExperimentStatusSchema = z.enum([
  'draft',
  'active',
  'review_ready',
  'completed',
  'interrupted',
  'superseded',
]);
export type ContinuityExperimentStatus = z.infer<typeof continuityExperimentStatusSchema>;

export const continuityExperimentBaselineSchema = z.object({
  cadence: continuityCadenceSchema,
  minAction: continuityMinActionSchema,
  validOpportunityCount: z.number().int().min(0),
  progressCount: z.number().int().min(0),
  incomparable: z.boolean(),
});
export type ContinuityExperimentBaseline = z.infer<typeof continuityExperimentBaselineSchema>;

export const continuityExperimentGoalSchema = z.object({
  cadence: continuityCadenceSchema,
  minAction: continuityMinActionSchema,
});
export type ContinuityExperimentGoal = z.infer<typeof continuityExperimentGoalSchema>;

export const continuityExperimentReviewSchema = z.object({
  actualProgress: z.number().int().min(0),
  metAgreement: z.boolean().nullable(),
  insufficientData: z.boolean(),
});
export type ContinuityExperimentReview = z.infer<typeof continuityExperimentReviewSchema>;

export const continuityExperimentCreateSchema = z.object({
  contractId: uuidSchema,
  hypothesis: z.string().max(4000).optional(),
  cadence: continuityCadenceSchema.optional(),
  minAction: continuityMinActionSchema.optional(),
  idempotencyKey: idempotencyKeySchema.optional(),
});
export type ContinuityExperimentCreateInput = z.infer<typeof continuityExperimentCreateSchema>;

export const continuityExperimentIdParamsSchema = z.object({
  id: uuidSchema,
});
export type ContinuityExperimentIdParams = z.infer<typeof continuityExperimentIdParamsSchema>;

export interface ContinuityExperiment {
  id: string;
  contractId: string;
  outcomeId: string;
  beforeRevision: number;
  afterRevision: number;
  hypothesis: string;
  baseline: ContinuityExperimentBaseline;
  goal: ContinuityExperimentGoal;
  windowStart: string;
  windowEnd: string;
  status: ContinuityExperimentStatus;
  review: ContinuityExperimentReview | null;
  reviewVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContinuityIntervention {
  id: string;
  contractId: string;
  outcomeId: string;
  revision: number;
  kind: ContinuityInterventionKind;
  factFingerprint: string;
  status: ContinuityInterventionStatus;
  expiresAt: string | null;
  actionableUntil: string | null;
  snoozedUntil: string | null;
  content: ContinuityInterventionContent;
  createdAt: string;
  updatedAt: string;
}

export interface ContinuityInterventionList {
  items: ContinuityIntervention[];
}

export const continuityBlockedTypeSchema = z.enum(['task', 'outcome']);
export type ContinuityBlockedType = z.infer<typeof continuityBlockedTypeSchema>;

export const continuityPrerequisiteTypeSchema = z.enum(['task', 'outcome', 'external']);
export type ContinuityPrerequisiteType = z.infer<typeof continuityPrerequisiteTypeSchema>;

export const continuityDependencyStatusSchema = z.enum(['open', 'resolved', 'canceled']);
export type ContinuityDependencyStatus = z.infer<typeof continuityDependencyStatusSchema>;

export const createContinuityDependencySchema = z
  .object({
    blockedType: continuityBlockedTypeSchema.optional(),
    blockedId: uuidSchema.optional(),
    prerequisiteType: continuityPrerequisiteTypeSchema,
    prerequisiteId: uuidSchema.optional(),
    externalLabel: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.prerequisiteType === 'external') {
      if (!value.externalLabel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['externalLabel'],
          message: 'external label required',
        });
      }
      if (value.prerequisiteId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['prerequisiteId'],
          message: 'external has no id',
        });
      }
      return;
    }
    if (!value.prerequisiteId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prerequisiteId'],
        message: 'prerequisite id required',
      });
    }
  });
export type CreateContinuityDependencyInput = z.infer<typeof createContinuityDependencySchema>;

export const patchContinuityDependencySchema = z.object({
  status: z.enum(['open', 'resolved']),
});
export type PatchContinuityDependencyInput = z.infer<typeof patchContinuityDependencySchema>;

export const continuityDependencyIdParamsSchema = z.object({
  id: uuidSchema,
});
export type ContinuityDependencyIdParams = z.infer<typeof continuityDependencyIdParamsSchema>;

export interface ContinuityDependency {
  id: string;
  contractId: string;
  blockedType: ContinuityBlockedType;
  blockedId: string;
  prerequisiteType: ContinuityPrerequisiteType;
  prerequisiteId: string | null;
  externalLabel: string | null;
  status: ContinuityDependencyStatus;
  resolvedAt: string | null;
  lastUserUpdateAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContinuityDependencyList {
  items: ContinuityDependency[];
}

export const continuityProtectedBlockKindSchema = z.enum(['once', 'weekly']);
export type ContinuityProtectedBlockKind = z.infer<typeof continuityProtectedBlockKindSchema>;

export const createContinuityProtectedBlockSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('once'),
    label: z.string().trim().min(1).max(120),
    timezone: ianaTimezoneSchema.optional(),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
  }),
  z.object({
    kind: z.literal('weekly'),
    label: z.string().trim().min(1).max(120),
    timezone: ianaTimezoneSchema.optional(),
    weekday: z.number().int().min(0).max(6),
    startHm: hmSchema,
    endHm: hmSchema,
  }),
]);
export type CreateContinuityProtectedBlockInput = z.infer<typeof createContinuityProtectedBlockSchema>;

export const patchContinuityProtectedBlockSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    timezone: ianaTimezoneSchema.optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    startHm: hmSchema.optional(),
    endHm: hmSchema.optional(),
  })
  .refine(
    (value) =>
      value.label !== undefined ||
      value.timezone !== undefined ||
      value.startAt !== undefined ||
      value.endAt !== undefined ||
      value.weekday !== undefined ||
      value.startHm !== undefined ||
      value.endHm !== undefined,
    { message: 'at least one field required' },
  );
export type PatchContinuityProtectedBlockInput = z.infer<typeof patchContinuityProtectedBlockSchema>;

export const continuityProtectedBlockIdParamsSchema = z.object({
  id: uuidSchema,
});
export type ContinuityProtectedBlockIdParams = z.infer<typeof continuityProtectedBlockIdParamsSchema>;

export interface ContinuityProtectedBlock {
  id: string;
  kind: ContinuityProtectedBlockKind;
  label: string;
  timezone: string;
  startAt: string | null;
  endAt: string | null;
  weekday: number | null;
  startHm: string | null;
  endHm: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContinuityProtectedBlockList {
  items: ContinuityProtectedBlock[];
}
