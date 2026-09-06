import { resolve, Service, useObserverService } from '@rabjs/react';
import {
  getThemeChoice,
  setThemeChoice,
  subscribeThemeChoice,
  type ThemeChoice,
} from '../theme/preference';

export class ThemeService extends Service {
  choice: ThemeChoice = getThemeChoice();
  private unsub: (() => void) | null = null;

  start(): void {
    if (this.unsub) return;
    this.choice = getThemeChoice();
    this.unsub = subscribeThemeChoice((choice) => {
      this.choice = choice;
    });
  }

  setChoice(choice: ThemeChoice): void {
    setThemeChoice(choice);
    this.choice = choice;
  }
}

export function themeService(): ThemeService {
  return resolve(ThemeService);
}

export function useThemeChoice(): ThemeChoice {
  const [choice] = useObserverService(ThemeService, (s) => s.choice);
  return choice;
}
