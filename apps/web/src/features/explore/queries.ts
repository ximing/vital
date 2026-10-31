import type {
  ExplorationProposal,
  ExplorationWindowDetail,
  ExplorationWindowList,
} from '@vital/dto';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';

export const exploreKeys = {
  all: ['explore'] as const,
  windows: ['explore', 'windows'] as const,
  window: (id: string) => ['explore', 'window', id] as const,
};

export function invalidateExplore(qc: QueryClient, windowId?: string): void {
  void qc.invalidateQueries({ queryKey: exploreKeys.all });
  void qc.invalidateQueries({ queryKey: exploreKeys.windows });
  if (windowId) void qc.invalidateQueries({ queryKey: exploreKeys.window(windowId) });
}

export function useExplorationWindowsQuery() {
  return useQuery({
    queryKey: exploreKeys.windows,
    queryFn: (): Promise<ExplorationWindowList> => client.listExplorationWindows(),
    retry: false,
  });
}

export function useExplorationWindowQuery(id: string) {
  return useQuery({
    queryKey: exploreKeys.window(id),
    enabled: id !== '',
    queryFn: (): Promise<ExplorationWindowDetail> => client.getExplorationWindow(id),
    retry: false,
  });
}

export function useExploreActions(windowId: string) {
  const qc = useQueryClient();
  const onSuccess = (windowIdToInvalidate = windowId) => {
    invalidateExplore(qc, windowIdToInvalidate);
  };

  const rest = useMutation({
    mutationFn: () => client.restExplorationWindow(windowId),
    onSuccess: () => onSuccess(),
  });
  const select = useMutation({
    mutationFn: (proposalId: string) => client.selectExplorationProposal(proposalId, {}),
    onSuccess: () => onSuccess(),
  });
  const confirm = useMutation({
    mutationFn: ({
      proposalId,
      acceptUnknown,
    }: {
      proposalId: string;
      acceptUnknown?: boolean;
    }) =>
      client.confirmExplorationProposal(proposalId, acceptUnknown ? { acceptUnknown: true } : {}),
    onSuccess: () => onSuccess(),
  });
  const reject = useMutation({
    mutationFn: (proposalId: string) => client.rejectExplorationProposal(proposalId),
    onSuccess: () => onSuccess(),
  });

  return { rest, select, confirm, reject };
}

export type { ExplorationProposal };
