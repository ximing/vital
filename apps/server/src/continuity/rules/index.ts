export { assignEvidence, evidenceSourceKey, isProgressEvidence } from './evidence.js';
export { evaluateStall, judgementOf } from './stall.js';
export {
  compareOpportunities,
  planOpportunities,
  timedWindowKey,
  weeklyWindowKey,
} from './opportunities.js';
export { recompute } from './recompute.js';
export {
  evaluateWorkRisk,
  expandProtectedBlock,
  isWorkRiskWorthShowing,
  occupancyFromTask,
  workRiskFactFingerprint,
  WORK_RISK_UNCONFIRMED,
  WORK_RISK_WINDOW_MS,
} from './work-risk.js';
export type {
  EvaluateWorkRiskInput,
  OccupancyInterval,
  WorkHours,
  WorkRiskDecision,
  WorkRiskDependency,
  WorkRiskKind,
  WorkRiskMissing,
  WorkRiskProtectedBlock,
} from './work-risk.js';
export type {
  AssignEvidenceInput,
  Evidence,
  EvidenceActor,
  EvidenceLink,
  EvidenceSourceType,
  EvaluateStallInput,
  Opportunity,
  OpportunityKind,
  OpportunityStatus,
  PauseRange,
  PlanOpportunitiesInput,
  RecomputeInput,
  RecomputeResult,
  RuleRevision,
  StallDecision,
  StallKind,
} from './types.js';
