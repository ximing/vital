import { z } from 'zod';
import { uuidSchema } from './lists.js';

export const agentActionTypeSchema = z.enum([
  'outcome.create',
  'outcome.headline',
  'outcome.suggestion',
  'task.decompose',
  'habit.create',
  'habit.adjust',
  'habit.nudge',
]);
export type AgentActionType = z.infer<typeof agentActionTypeSchema>;

export const agentTargetTypeSchema = z.enum(['outcome', 'task', 'habit']);
export type AgentTargetType = z.infer<typeof agentTargetTypeSchema>;

export const agentFeedbackSchema = z.enum(['pending', 'accepted', 'edited', 'dismissed']);
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
  totalRuns: number;
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
 * `adopted` = feedback 'accepted' or 'edited'; `dismissed` = feedback 'dismissed'.
 */
export interface AgentAdoptionDaily {
  /** YYYY-MM-DD in the user's timezone. */
  date: string;
  proposed: number;
  adopted: number;
  dismissed: number;
  /**
   * adopted / (adopted + dismissed) — the share of *decided* actions that were
   * adopted. Pending actions are excluded from the denominator (they have no
   * verdict yet); 0 when nothing has been decided that day.
   */
  adoptionRate: number;
}

export interface AgentMetricsSummary {
  proposed: number;
  adopted: number;
  dismissed: number;
  /** Same formula as the daily rows, totaled over the window. */
  adoptionRate: number;
  /** adoptionRate of the preceding window of the same length, for trend arrows. */
  prevAdoptionRate: number;
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

/** Injection filter: capabilities a memory row may be injected into ('all' = every capability). */
export const agentMemoryScopeSchema = z.enum([
  'all',
  'headline',
  'cluster',
  'decompose',
  'reflect',
  'distill',
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
