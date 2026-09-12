import { Service } from '@rabjs/react';
import { markOnboarding } from '../../lib/onboarding';
import { AuthService } from '../../services/auth.service';

const HREFS = ['/inbox', '/', '/reports'] as const;

export class OnboardingService extends Service {
  step = 0;
  busy = false;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get href(): string | undefined {
    return HREFS[this.step];
  }

  next(): 'home' | 'stay' {
    if (this.step >= HREFS.length - 1) return 'home';
    this.step += 1;
    return 'stay';
  }

  async skipAll(): Promise<void> {
    this.busy = true;
    try {
      await markOnboarding(this.auth.user, (next) => this.auth.refreshUser(next), { dismissed: true });
    } finally {
      this.busy = false;
    }
  }

  goAction(): void {
    if (this.href === '/reports') {
      void markOnboarding(this.auth.user, (next) => this.auth.refreshUser(next), { openedWeekly: true });
    }
  }
}
