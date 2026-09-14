import { loginInputSchema } from '@vital/dto';
import { Service } from '@rabjs/react';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { afterAuthPath } from '@/shell/require-auth';

export type LoginFieldErrors = { email?: string; password?: string };

export class LoginPageService extends Service {
  email = '';
  password = '';
  errors: LoginFieldErrors = {};
  formError: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  setEmail(value: string): void {
    this.email = value;
  }

  setPassword(value: string): void {
    this.password = value;
  }

  validate(): boolean {
    const parsed = loginInputSchema.safeParse({ email: this.email, password: this.password });
    if (!parsed.success) {
      const next: LoginFieldErrors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'email' && next.email === undefined) next.email = t.auth.invalidEmail;
        if (issue.path[0] === 'password' && next.password === undefined) {
          next.password = t.auth.passwordRequired;
        }
      }
      this.errors = next;
      return false;
    }
    this.errors = {};
    this.formError = null;
    return true;
  }

  async login(from: string | undefined): Promise<string | null> {
    try {
      await this.auth.login({ email: this.email, password: this.password });
    } catch (err) {
      this.formError = humanError(err);
      return null;
    }
    return afterAuthPath(from, this.auth.user);
  }
}
