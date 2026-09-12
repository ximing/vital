import { z } from 'zod';
import { uuidSchema } from './lists.js';

export const agentActionTypeSchema = z.enum([
  'outcome.create',
  'outcome.headline',
  'outcome.suggestion',
  'task.decompose',
  'task.draft',
  'habit.create',
  'habit.adjust',
  'habit.nudge',
  'report.generate',
]);
export type AgentActionType = z.infer<typeof agentActionTypeSchema>;

export const agentTargetTypeSchema = z.enum(['outcome', 'task', 'habit', 'report']);
export type AgentTargetType = z.infer<typeof agentTargetTypeSchema>;

export const agentFeedbackSchema = z.enum([
  'pending',
  'accepted',
  'edited',
  'dismissed',
  /** Terminal state after a successful undo of a materialized acceptance. */
  'undone',
]);
export type AgentFeedback = z.infer<typeof agentFeedbackSchema>;

export interface AgentAction {
  id: string;
  actionType: AgentActionType;
  targetType: AgentTargetType;
  targetId: string;
  payload: Record<string, unknown>;
  feedback: AgentFeedback;
  feedbackPayload: Record<string, unknown> | null;
  feedbackAt: string | null;
  createdAt: string;
}

/** A ledger row enriched for the settings activity view (joined target name + payload digest). */
export interface AgentActionLogItem extends AgentAction {
  /** Target name/title at read time; null when the target was deleted or undone. */
  targetName: string | null;
  /** Human-oriented one-line summary distilled from payload per action type. */
  payloadSummary: string;
}

export const actionFeedbackInputSchema = z.object({
  feedback: z.enum(['accepted', 'dismissed', 'edited']),
  editedPayload: z.record(z.unknown()).optional(),
});
export type ActionFeedbackInput = z.infer<typeof actionFeedbackInputSchema>;

export const agentActionIdParamsSchema = z.object({
  id: uuidSchema,
});
export type AgentActionIdParams = z.infer<typeof agentActionIdParamsSchema>;

/**
 * POST /tasks/:id/draft result: 'pending' returns the existing un-decided
 * draft (idempotent re-trigger); 'queued' means a task.draft job was (re)armed.
 */
export interface TaskDraftTrigger {
  status: 'queued' | 'pending';
  action: AgentAction | null;
}

/** Filters for listing the caller's agent actions (e.g. pending decompose for a task). */
export const agentActionsQuerySchema = z.object({
  targetType: agentTargetTypeSchema.optional(),
  targetId: uuidSchema.optional(),
  actionType: agentActionTypeSchema.optional(),
  feedback: agentFeedbackSchema.optional(),
  /** Age window in days, clamped to 1..90 (usage-endpoint convention). Absent = no window. */
  days: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : Number(value)))
    .pipe(z.number().int().min(1).optional())
    .transform((value) => (value === undefined ? undefined : Math.min(value, 90))),
});
export type AgentActionsQuery = z.infer<typeof agentActionsQuerySchema>;

export interface AgentUsageDaily {
  /** YYYY-MM-DD in the user's timezone. */
  date: string;
  capability: string;
  runs: number;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
}

export interface AgentUsageSummary {
  days: number;
  /** Historical rows plus new model requests; use modelRequests for actual request count. */
  totalRuns: number;
  modelRequests?: number;
  failedRequests?: number;
  unknownUsageRequests?: number;
  unknownCostRequests?: number;
  legacyRuns?: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostMicros: number;
  items: AgentUsageDaily[];
}

export const agentUsageQuerySchema = z.object({
  days: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? 30 : Number(value)))
    .pipe(z.number().int().min(1))
    .transform((value) => Math.min(value, 90)),
});
export type AgentUsageQuery = z.infer<typeof agentUsageQuerySchema>;

/**
 * Daily adoption metrics for agent actions — the evidence that self-improvement
 * is actually happening. `proposed` counts every action (pending included);
 * `adopted` = feedback 'accepted' or 'edited'; `dismissed` = feedback 'dismissed';
 * `undone` = accepted then undone via the undo endpoint (a strong correction
 * signal: it never counts as adopted).
 */
export interface AgentAdoptionDaily {
  /** YYYY-MM-DD in the user's timezone. */
  date: string;
  proposed: number;
  adopted: number;
  dismissed: number;
  undone: number;
  /**
   * adopted / (adopted + dismissed) — the share of *decided* actions that were
   * adopted. Pending actions are excluded from the denominator (they have no
   * verdict yet); 0 when nothing has been decided that day.
   */
  adoptionRate: number;
}

/**
 * Amortized effective cost of one proposal-producing capability over the metrics
 * window. `costMicros` is the capability's agent_usage total; `adopted` counts the
 * actions attributed to it via the capability↔actionType map (accepted + edited;
 * undone never counts). A single run may emit several actions (headline →
 * headline + suggestion), so `costPerAdoptedMicros` divides the run cost across
 * the adopted proposals — the cost of *each adopted suggestion*, not each run.
 */
export interface AgentCapabilityCost {
  /** Usage capability key as written to agent_usage.capability ('headline', 'cluster', 'decompose', 'draft'). */
  capability: string;
  /** Total cost of that capability's model runs in the current window (micro-USD). */
  costMicros: number;
  /** Adopted proposals attributed via the map; 0 when everything was dismissed/undone/pending. */
  adopted: number;
  /** costMicros / adopted; null when adopted = 0 — nothing to amortize over. */
  costPerAdoptedMicros: number | null;
}

export interface AgentMetricsSummary {
  proposed: number;
  adopted: number;
  dismissed: number;
  undone: number;
  /** Same formula as the daily rows, totaled over the window. */
  adoptionRate: number;
  /** adoptionRate of the preceding window of the same length, for trend arrows. */
  prevAdoptionRate: number;
  /**
   * Current-window cost per capability. Deliberately NO prev-window trend here
   * (unlike prevAdoptionRate): cost comparisons across windows are not part of
   * the contract — do not build trend UI on top of this.
   */
  perCapability: AgentCapabilityCost[];
}

export interface AgentMetricsResponse {
  daily: AgentAdoptionDaily[];
  summary: AgentMetricsSummary;
}

export const agentMetricsQuerySchema = z.object({
  days: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? 30 : Number(value)))
    .pipe(z.number().int().min(1))
    .transform((value) => Math.min(value, 90)),
});
export type AgentMetricsQuery = z.infer<typeof agentMetricsQuerySchema>;

/** Server-derived scheduling state — pure timestamp comparison, timezone-independent. */
export const agentScheduleStatusSchema = z.enum(['idle', 'waiting', 'due', 'cooldown']);
export type AgentScheduleStatus = z.infer<typeof agentScheduleStatusSchema>;

/** Capabilities with a persistent scheduling row. */
export const AGENT_SCHEDULE_CAPABILITIES = ['outcome.cluster', 'memory.distill'] as const;
export type AgentScheduleCapability = (typeof AGENT_SCHEDULE_CAPABILITIES)[number];

/**
 * One capability's scheduling state, as shown in the settings schedule view.
 * All timestamps are ISO strings; `status` is derived server-side in the locked
 * order idle → waiting → due → cooldown (e.g. a due row with an active cooldown
 * reports 'due' — it is waiting for the worker scan, not the cooldown).
 */
export interface AgentScheduleItem {
  capability: AgentScheduleCapability;
  generation: number;
  processedGeneration: number;
  pendingCount: number;
  urgent: boolean;
  pendingSince: string | null;
  dueAt: string | null;
  cooldownUntil: string | null;
  lastSucceededAt: string | null;
  observedAt: string | null;
  updatedAt: string;
  status: AgentScheduleStatus;
}

export interface AgentScheduleResponse {
  /** One row per scheduled capability; capabilities without state come back as synthesized idle rows. */
  items: AgentScheduleItem[];
}

/** Injection filter: capabilities a memory row may be injected into ('all' = every capability). */
export const agentMemoryScopeSchema = z.enum([
  'all',
  'headline',
  'cluster',
  'decompose',
  'draft',
  'reflect',
  'distill',
  'notify',
  'report',
]);
export type AgentMemoryScopeValue = z.infer<typeof agentMemoryScopeSchema>;

export const agentMemoryKindSchema = z.enum(['preference', 'pattern', 'correction']);
export type AgentMemoryKind = z.infer<typeof agentMemoryKindSchema>;

/** One row of the agent's long-term memory, as shown on the settings memory tab. */
export interface AgentMemoryItem {
  id: string;
  kind: AgentMemoryKind;
  content: string;
  scope: string[];
  /** How many distilled actions contributed to this row. 0 for user-written rows. */
  sourceCount: number;
  /** User-written rows are protected: distill may never update or drop them. */
  manual: boolean;
  createdAt: string;
  updatedAt: string;
}

export const createAgentMemorySchema = z.object({
  kind: agentMemoryKindSchema,
  content: z.string().trim().min(1).max(300),
  scope: z.array(agentMemoryScopeSchema).default(['all']),
});
export type CreateAgentMemoryInput = z.infer<typeof createAgentMemorySchema>;

export const patchAgentMemorySchema = z
  .object({
    kind: agentMemoryKindSchema.optional(),
    content: z.string().trim().min(1).max(300).optional(),
    scope: z.array(agentMemoryScopeSchema).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchAgentMemoryInput = z.infer<typeof patchAgentMemorySchema>;

export const agentMemoryIdParamsSchema = z.object({
  id: uuidSchema,
});
export type AgentMemoryIdParams = z.infer<typeof agentMemoryIdParamsSchema>;

/** Execution history is separate from actionable proposals and their feedback. */
export interface AgentExecution {
  id: string;
  parentId: string | null;
  jobId: string | null;
  capability: string;
  trigger?: string | null;
  inputSummary?: string | null;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  attempt: number;
  reason: string | null;
  targetType: string | null;
  targetId: string | null;
  resultSummary: string | null;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}
