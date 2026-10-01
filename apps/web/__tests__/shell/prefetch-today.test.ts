import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { todayKeys } from '../../src/features/today/query-keys';
import { todoKeys } from '../../src/features/todos/query-keys';
import { prefetchTodayHome } from '../../src/shell/prefetch-today';

describe('prefetchTodayHome', () => {
  it('starts the today dashboard, habits, and lists before the page chunk arrives', () => {
    const prefetchQuery = vi.fn((_options: { queryKey: readonly unknown[] }) => Promise.resolve(undefined));
    prefetchTodayHome({
      prefetchQuery: prefetchQuery as unknown as QueryClient['prefetchQuery'],
    });
    expect(prefetchQuery.mock.calls.map((call) => call[0].queryKey)).toEqual([
      todayKeys.dashboard,
      todayKeys.habits,
      todoKeys.lists,
    ]);
  });
});
