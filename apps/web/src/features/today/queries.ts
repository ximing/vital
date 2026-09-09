import type {
  AgentAction,
  CreateOutcomeInput,
  Habit,
  Outcome,
  PatchOutcomeInput,
  TodayDashboard,
} from '@vital/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';

export const todayKeys = {
  all: ['today'] as const,
  dashboard: ['today', 'dashboard'] as const,
  outcomes: (status: 'open' | 'closed' = 'open') => ['today', 'outcomes', status] as const,
  habits: ['today', 'habits'] as const,
  decompose: (taskId: string) => ['today', 'decompose', taskId] as const,
};

export function useTodayQuery() {
  return useQuery({
    queryKey: todayKeys.dashboard,
    queryFn: (): Promise<TodayDashboard> => client.getToday(),
  });
}

export function useOutcomesQuery(status: 'open' | 'closed' = 'open') {
  return useQuery({
    queryKey: todayKeys.outcomes(status),
    queryFn: (): Promise<Outcome[]> => client.listOutcomes(status),
  });
}

export function useHabitsQuery() {
  return useQuery({
    queryKey: todayKeys.habits,
    queryFn: (): Promise<Habit[]> => client.listHabits(),
  });
}

/** Pending agent proposals (task.decompose etc.) targeting one task. */
export function usePendingDecomposeQuery(taskId: string | null) {
  return useQuery({
    queryKey: todayKeys.decompose(taskId ?? ''),
    enabled: taskId !== null,
    queryFn: (): Promise<AgentAction[]> =>
      client.listAgentActions({ targetType: 'task', targetId: taskId ?? '', feedback: 'pending' }),
  });
}

export function useOutcomeActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: todayKeys.all });

  const create = useMutation({
    mutationFn: (input: CreateOutcomeInput) => client.createOutcome(input),
    onSuccess: () => invalidate(),
  });

  const patch = useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchOutcomeInput }) =>
      client.patchOutcome(id, input),
    onSuccess: () => invalidate(),
  });

  const close = useMutation({
    mutationFn: (id: string) => client.closeOutcome(id),
    onSuccess: () => invalidate(),
  });

  const reopen = useMutation({
    mutationFn: (id: string) => client.reopenOutcome(id),
    onSuccess: () => invalidate(),
  });

  const undo = useMutation({
    mutationFn: (id: string) => client.undoOutcome(id),
    onSuccess: () => invalidate(),
  });

  /** Lightweight retry for a failed agent refresh (W2 runtime enqueues the job). */
  const refresh = useMutation({
    mutationFn: (id: string) => client.refreshOutcome(id),
    onSuccess: () => invalidate(),
  });

  return { create, patch, close, reopen, undo, refresh, invalidate };
}
