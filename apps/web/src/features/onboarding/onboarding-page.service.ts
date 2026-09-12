import { Service } from '@rabjs/react';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { markOnboarding } from './mark';
import { ONBOARDING_HREFS } from './model';

export class OnboardingPageService extends Service {
  step = 0;
  error: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  next(): 'home' | void {
    if (this.step >= ONBOARDING_HREFS.length - 1) return 'home';
    this.step += 1;
  }

  async skipAll(): Promise<boolean> {
    this.error = null;
    try {
      await markOnboarding({ dismissed: true });
      return true;
    } catch (err) {
      this.error = humanError(err);
      return false;
    }
  }
}
