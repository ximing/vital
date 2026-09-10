import { z } from 'zod';
import type { AgentActionLogItem } from './agent.js';
import type { InboxSource, InboxStatus } from './inbox.js';
import { uuidSchema } from './lists.js';
import type { Task } from './tasks.js';

export const outcomeStatusSchema = z.enum(['open', 'closed']);
export type OutcomeStatus = z.infer<typeof outcomeStatusSchema>;

export const outcomeSignalSchema = z.enum(['up', 'flat', 'alert']);
export type OutcomeSignal = z.infer<typeof outcomeSignalSchema>;

export const outcomeCreatedBySchema = z.enum(['user', 'agent']);
export type OutcomeCreatedBy = z.infer<typeof outcomeCreatedBySchema>;

export const outcomeAgentStateSchema = z.enum(['idle', 'pending', 'failed']);
export type OutcomeAgentState = z.infer<typeof outcomeAgentStateSchema>;

export interface Outcome {
  id: string;
  name: string;
  status: OutcomeStatus;
  createdBy: OutcomeCreatedBy;
  ruleSignal: OutcomeSignal | null;
  ruleNextStep: string | null;
  agentHeadline: string | null;
  agentSuggestion: string | null;
  agentState: OutcomeAgentState;
  agentUpdatedAt: string | null;
  /** Agent-created threads can be undone until this instant. */
  undoUntil: string | null;
  lastActivityAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Computed at read time, not stored. */
  openTaskCount: number;
  completedLast7d: number;
  materialCount: number;
}

export const createOutcomeInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateOutcomeInput = z.infer<typeof createOutcomeInputSchema>;

export const patchOutcomeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchOutcomeInput = z.infer<typeof patchOutcomeInputSchema>;

export const listOutcomesQuerySchema = z.object({
  status: outcomeStatusSchema.optional(),
});
export type ListOutcomesQuery = z.infer<typeof listOutcomesQuerySchema>;

/** One-line pulse of the whole system, shown above the board. */
export interface TodayPulse {
  inboxPending: number;
  reportStreak: number;
  /** Current day's daily report id when it exists (has content), else null. */
  todayReportId: string | null;
}

/** One recommended task inside the Now card. */
export interface NowRecommendation {
  taskId: string;
  title: string;
  estimateMinutes: number | null;
  outcomeId: string | null;
  dueAt: string | null;
  /** Due on the current local day or already overdue. */
  dueSoon: boolean;
}

/** "当下" card payload: continuous free time plus rule-based picks. */
export interface TodayNow {
  /** Minutes until the nearest boundary (habit window end / quiet start / day end). */
  continuousMinutes: number;
  /** Inside quiet hours — recommendations are suppressed. */
  quiet: boolean;
  recommendations: NowRecommendation[];
  /** Rule-layer copy; the agent layer may later replace it with a headline. */
  reason: string;
}

export interface TodayDashboard {
  outcomes: Outcome[];
  tasks: Task[];
  pulse: TodayPulse;
  now: TodayNow;
  generatedAt: string;
}

export const outcomeIdParamsSchema = z.object({
  id: uuidSchema,
});
export type OutcomeIdParams = z.infer<typeof outcomeIdParamsSchema>;

/** Slim inbox material row attached to a thread (no heavy extract bodies). */
export interface OutcomeMaterial {
  id: string;
  title: string;
  excerpt: string | null;
  siteName: string | null;
  source: InboxSource;
  status: InboxStatus;
  capturedAt: string;
}

/** Aggregated payload for the thread drill-down page (/today/threads/:id). */
export interface OutcomeDetail {
  outcome: Outcome;
  /** All non-deleted tasks of this thread; the client groups them open/done. */
  tasks: Task[];
  materials: OutcomeMaterial[];
  /** Agent ledger rows touching this thread or its tasks, newest first. */
  agentActions: AgentActionLogItem[];
}
