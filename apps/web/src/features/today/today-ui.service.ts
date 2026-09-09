import { resolve, Service, useObserverService } from '@rabjs/react';

export class TodayUiService extends Service {
  /** Outcome card currently filtering the today task list; null = no filter. */
  selectedOutcomeId: string | null = null;

  setSelectedOutcome(id: string | null): void {
    this.selectedOutcomeId = id;
  }

  toggleOutcome(id: string): void {
    this.selectedOutcomeId = this.selectedOutcomeId === id ? null : id;
  }

  reset(): void {
    this.selectedOutcomeId = null;
  }
}

export function todayUi(): TodayUiService {
  return resolve(TodayUiService);
}

export function useTodayUi<T>(selector: (s: TodayUiService) => T): T {
  const [value] = useObserverService(TodayUiService, selector);
  return value;
}

export function resetTodayUi(): void {
  todayUi().reset();
}
