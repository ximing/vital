import { t } from '@/copy';

/** Route-level Suspense fallback — same skeleton language as TaskSkeleton. */
export function RouteFallback() {
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col justify-center gap-3 bg-canvas px-3 py-6"
      aria-busy="true"
      aria-label={t.todos.loading}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton-pulse h-11 rounded-2xl" />
      ))}
    </div>
  );
}
