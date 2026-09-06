import { resolve, Service, useObserverService } from '@rabjs/react';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '@/lib/theme';

export class ThemeService extends Service {
  choice: ThemeChoice = typeof window === 'undefined' ? 'system' : getThemeChoice();

  setChoice(choice: ThemeChoice): void {
    setThemeChoice(choice);
    this.choice = choice;
  }

  reset(): void {
    this.choice = typeof window === 'undefined' ? 'system' : getThemeChoice();
  }
}

export function themeService(): ThemeService {
  return resolve(ThemeService);
}

export function useThemeService<T>(selector: (s: ThemeService) => T): T {
  const [value] = useObserverService(ThemeService, selector);
  return value;
}
