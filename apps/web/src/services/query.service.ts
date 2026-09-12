import { QueryClient } from '@tanstack/react-query';
import { resolve, Service } from '@rabjs/react';

/** Module-level cache — QueryClient is not domain state and must not be observed. */
export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

/**
 * Global handle to the HTTP cache. Page services invalidate through this
 * instead of importing QueryClient in UI components.
 */
export class QueryService extends Service {
  get client(): QueryClient {
    return appQueryClient;
  }

  invalidate(queryKey: readonly unknown[]): Promise<void> {
    return appQueryClient.invalidateQueries({ queryKey });
  }

  setQueryData<T>(queryKey: readonly unknown[], data: T): void {
    appQueryClient.setQueryData(queryKey, data);
  }
}

export function queryService(): QueryService {
  return resolve(QueryService);
}
