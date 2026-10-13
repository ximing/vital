export {
  clothingSuggestion,
  describeTodayLayoutFacts,
  nearestStatutoryHoliday,
  normalizeCalendarEvent,
  normalizeTodayLayout,
  todayModulesOrFallback,
  upcomingExcludingToday,
} from '@vital/dto';

const WIDE_MODULE_IDS = new Set(['lead', 'note', 'focus']);

/** Same placement as the web grid: lead, note, and focus take a row; the others pair. */
export function groupTodayModuleRows<T extends { id: string }>(
  modules: readonly T[],
  columns: 1 | 2,
): T[][] {
  if (columns === 1) return modules.map((module) => [module]);
  const rows: T[][] = [];
  let pending: T | null = null;
  for (const module of modules) {
    if (WIDE_MODULE_IDS.has(module.id)) {
      if (pending) {
        rows.push([pending]);
        pending = null;
      }
      rows.push([module]);
      continue;
    }
    if (pending) {
      rows.push([pending, module]);
      pending = null;
    } else {
      pending = module;
    }
  }
  if (pending) rows.push([pending]);
  return rows;
}
