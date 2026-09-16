export const todayKeys = {
  all: ['today'] as const,
  dashboard: ['today', 'dashboard'] as const,
  outcomes: (status: 'open' | 'closed' | 'all' = 'open') => ['today', 'outcomes', status] as const,
  detail: (id: string) => ['today', 'thread', id] as const,
  habits: ['today', 'habits'] as const,
  decompose: (taskId: string) => ['today', 'decompose', taskId] as const,
  agentPending: ['today', 'agent-pending'] as const,
  agentExecStatus: ['today', 'agent-exec-status'] as const,
};
