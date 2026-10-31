/** Public API for other features. Workspace roots stay file-imported (App lazy + cycle break). */
export { canOpenCalendarSettings, openCalendarSettings } from './briefing';
export { DecomposeBanner } from './DecomposeBanner';
export { HabitRing } from './HabitRing';
export { decomposeSubtasks, habitTodayProgress, isUndoable } from './model';
export { todayKeys } from './query-keys';
export {
  useAllOutcomesQuery,
  useContinuityInterventionsQuery,
  useHabitsQuery,
  useOutcomeActions,
  useOutcomeContinuityQuery,
  useOutcomeDetailQuery,
  useOutcomesQuery,
  usePendingDecomposeQuery,
  useTodayQuery,
} from './queries';
