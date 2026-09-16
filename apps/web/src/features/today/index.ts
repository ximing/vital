/** Public API for other features. Workspace roots stay file-imported (App lazy + cycle break). */
export { DecomposeBanner } from './DecomposeBanner';
export { HabitRing } from './HabitRing';
export { decomposeSubtasks, habitTodayProgress, isUndoable } from './model';
export { todayKeys } from './query-keys';
export {
  useAllOutcomesQuery,
  useHabitsQuery,
  useOutcomeActions,
  useOutcomeDetailQuery,
  useOutcomesQuery,
  usePendingDecomposeQuery,
  useTodayQuery,
} from './queries';
