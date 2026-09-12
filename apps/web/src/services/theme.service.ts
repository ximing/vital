import { resolve, Service } from '@rabjs/react';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '@/lib/theme';

export class ThemeService extends Service {
  choice: ThemeChoice = typeof window === 'undefined' ? 'system' : getThemeChoice();

  setChoice(choice: ThemeChoice): void {
    this.choice = choice;
    setThemeChoice(choice);
  }

  reset(): void {
    this.choice = typeof window === 'undefined' ? 'system' : getThemeChoice();
  }
}

export function themeService(): ThemeService {
  return resolve(ThemeService);
}
