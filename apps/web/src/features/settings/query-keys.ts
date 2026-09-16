export const settingsKeys = {
  all: ['settings'] as const,
  agentActivity: (days: number) => ['settings', 'agent-activity', days] as const,
  agentActivityRoot: ['settings', 'agent-activity'] as const,
  agentMetrics: (days: number) => ['settings', 'agent-metrics', days] as const,
  agentMetricsRoot: ['settings', 'agent-metrics'] as const,
  agentExecutions: (days: number) => ['settings', 'agent-executions', days] as const,
  agentExecutionsRoot: ['settings', 'agent-executions'] as const,
  agentSchedule: ['settings', 'agent-schedule'] as const,
  agentUsage: (days: number) => ['settings', 'agent-usage', days] as const,
};
