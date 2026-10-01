import { useEffect, useState } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { TODAY_HOME_STALE_MS, todayKeys } from '@/features/today/query-keys';
import { todoKeys } from '@/features/todos/query-keys';

const WARM_WAIT_MS = 4_000;

/** Start the Today reads while the shell chunk is still downloading. */
export function prefetchTodayHome(qc: Pick<QueryClient, 'prefetchQuery'>): void {
  const staleTime = TODAY_HOME_STALE_MS;
  void qc.prefetchQuery({
    queryKey: todayKeys.dashboard,
    queryFn: () => client.getToday(),
    staleTime,
  });
  void qc.prefetchQuery({
    queryKey: todayKeys.habits,
    queryFn: () => client.listHabits(),
    staleTime,
  });
  void qc.prefetchQuery({
    queryKey: todoKeys.lists,
    queryFn: async () => (await client.listLists()).items,
    staleTime,
  });
}

/**
 * True once Today's dashboard request has settled, or after a few seconds.
 * Neighbor chunks wait for this so they do not compete with the first paint data.
 */
export function useTodayDataReady(active: boolean): boolean {
  const query = useQuery({
    queryKey: todayKeys.dashboard,
    queryFn: () => client.getToday(),
    enabled: active,
    staleTime: TODAY_HOME_STALE_MS,
  });
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!active || query.isFetched) return;
    const id = window.setTimeout(() => setGaveUp(true), WARM_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [active, query.isFetched]);

  if (!active) return true;
  return query.isFetched || gaveUp;
}
