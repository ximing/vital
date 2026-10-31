import type { ContinuityCadence, ContinuityJudgement } from '@vital/dto';

export type OpportunityKind = 'timed' | 'weekly_count';
export type OpportunityStatus = 'scheduled' | 'open' | 'met' | 'missed' | 'exempt' | 'canceled';
export type EvidenceSourceType =
  | 'task_done'
  | 'habit_checkin'
  | 'self_report'
  | 'user_confirm'
  | 'agent_prep';
export type EvidenceActor = 'user' | 'agent' | 'system';
export type StallKind = 'none' | 'watching' | 'stall';

/** Mirrors continuity_opportunities (camelCase) plus rule-only observeOnly. */
export type Opportunity = {
  id: string;
  userId: string;
  contractId: string;
  revision: number;
  kind: OpportunityKind;
  windowKey: string;
  startsAt: Date;
  endsAt: Date;
  checkAt: Date;
  localStartDate: string;
  localEndDate: string;
  timezoneSnapshot: string;
  targetCount: number;
  status: OpportunityStatus;
  exemptReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** First activation partial week; not a DB column. Re-derived from activatedAt. */
  observeOnly: boolean;
};

/** Mirrors continuity_evidence. opportunityId is an explicit user/binding target. */
export type Evidence = {
  id: string;
  userId?: string;
  sourceType: EvidenceSourceType;
  sourceId: string | null;
  sourceRevision: number | null;
  actor: EvidenceActor;
  occurredAt: Date;
  recordedAt: Date;
  body: Record<string, unknown>;
  supersedesId: string | null;
  retractedAt: Date | null;
  idempotencyKey?: string | null;
  opportunityId?: string;
};

/** Mirrors continuity_evidence_links. */
export type EvidenceLink = {
  id: string;
  userId: string;
  evidenceId: string;
  contractId: string;
  opportunityId: string | null;
  meetsCriteria: boolean;
  rationale: string | null;
  createdAt: Date;
};

export type PauseRange = {
  start: Date;
  end: Date | null;
};

export type RuleRevision = {
  revision: number;
  cadence: ContinuityCadence;
  timezone: string;
  weekStartsOn: 0 | 1;
  activatedAt: Date;
  userId?: string;
  contractId?: string;
};

export type StallDecision = {
  kind: StallKind;
  factRefs: {
    opportunityIds: string[];
    progressCount: number;
    reasonCode: 'no_record' | null;
  };
};

export type PlanOpportunitiesInput = {
  revision: RuleRevision;
  existing: readonly Opportunity[];
  pauseRanges: readonly PauseRange[];
  now: Date;
  horizonEnd: Date;
};

export type AssignEvidenceInput = {
  opportunities: readonly Opportunity[];
  evidence: readonly Evidence[];
  now: Date;
};

export type EvaluateStallInput = {
  opportunities: readonly Opportunity[];
  now: Date;
  revision: number;
  cadenceKind: OpportunityKind;
};

export type RecomputeInput = {
  revision: RuleRevision;
  existing: readonly Opportunity[];
  evidence: readonly Evidence[];
  pauseRanges: readonly PauseRange[];
  now: Date;
  horizonEnd: Date;
};

export type RecomputeResult = {
  opportunities: Opportunity[];
  links: EvidenceLink[];
  judgement: ContinuityJudgement;
  stall: StallDecision;
};
