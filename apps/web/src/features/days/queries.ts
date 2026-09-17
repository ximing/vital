import type { Day, DayCatalogResponse, PatchDayInput } from '@vital/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { todayKeys } from '@/features/today/query-keys';
import { dayKeys } from './query-keys';

export function useDaysQuery() {
  return useQuery({
    queryKey: dayKeys.list,
    queryFn: async (): Promise<Day[]> => {
      const res = await client.listDays();
      return res.items;
    },
  });
}

export function useDayCatalogQuery(enabled: boolean) {
  return useQuery({
    queryKey: dayKeys.catalog,
    enabled,
    queryFn: (): Promise<DayCatalogResponse> => client.listDayCatalog(),
  });
}

export function useDayMutations() {
  const qc = useQueryClient();
  async function invalidate() {
    await qc.invalidateQueries({ queryKey: dayKeys.all });
    await qc.invalidateQueries({ queryKey: todayKeys.dashboard });
  }
  const patch = useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchDayInput }) => client.patchDay(id, input),
    onSuccess: () => void invalidate(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.deleteDay(id),
    onSuccess: () => void invalidate(),
  });
  return { patch, remove, invalidate };
}
