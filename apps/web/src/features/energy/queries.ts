import type { CreateEnergyLogInput, EnergyLogList } from '@vital/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { energyKeys } from './query-keys';

export function useEnergyLogsQuery(date: string) {
  return useQuery({
    queryKey: energyKeys.day(date),
    queryFn: (): Promise<EnergyLogList> => client.listEnergyLogs({ date }),
  });
}

export function useCreateEnergyLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEnergyLogInput) => client.createEnergyLog(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: energyKeys.all }),
  });
}
