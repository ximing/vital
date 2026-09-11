import type { AgentActionType } from '@vital/dto';

/**
 * Which proposal-producing agent capability owns which agent_actions types —
 * the join between agent_usage.cost_micros and agent_actions.feedback.
 *
 * Keys are the values actually written to agent_usage.capability (llm/telemetry.ts
 * strips the agent/task prefix from the LLM capability). Derived from the
 * recordAgentAction call sites in processors.ts:
 * - headline (agent.headline, processOutcomeRefresh) emits headline + suggestion
 * - cluster  (agent.cluster, processOutcomeCluster)  emits outcome.create
 * - decompose (agent.decompose, processTaskDecompose) emits task.decompose
 * - draft    (agent.draft, processTaskDraft)         emits task.draft
 *
 * A run may emit several actions, so per-capability cost is an *amortized*
 * figure: the capability's total cost divided by its adopted proposals.
 *
 * capability-map.test.ts locks this against agentActionTypeSchema — adding a
 * capability or action type without updating the map fails that test on purpose.
 */
export const CAPABILITY_ACTION_MAP = {
  headline: ['outcome.headline', 'outcome.suggestion'],
  cluster: ['outcome.create'],
  decompose: ['task.decompose'],
  draft: ['task.draft'],
} as const satisfies Record<string, readonly AgentActionType[]>;

export type CostCapability = keyof typeof CAPABILITY_ACTION_MAP;

/** Action types with no producing model run (rule-based processors) — cost can never be attributed to them. */
export const KNOWN_UNMAPPED_ACTION_TYPES = ['habit.create', 'habit.adjust', 'habit.nudge'] as const satisfies readonly AgentActionType[];

const ACTION_TYPE_TO_CAPABILITY = new Map<string, CostCapability>(
  (Object.entries(CAPABILITY_ACTION_MAP) as [CostCapability, readonly AgentActionType[]][]).flatMap(
    ([capability, actionTypes]) => actionTypes.map((actionType) => [actionType, capability] as const),
  ),
);

export function capabilityOfActionType(actionType: string): CostCapability | null {
  return ACTION_TYPE_TO_CAPABILITY.get(actionType) ?? null;
}
