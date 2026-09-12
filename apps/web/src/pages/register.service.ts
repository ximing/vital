import { registerInputSchema } from '@vital/dto';
import { Service } from '@rabjs/react';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';

export type RegisterFieldErrors = {
  email?: string;
  displayName?: string;
  password?: string;
  confirm?: string;
};

export class RegisterPageService extends Service {
  email = '';
  displayName = '';
  password = '';
  confirm = '';
  errors: RegisterFieldErrors = {};
  formError: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  setEmail(value: string): void {
    this.email = value;
  }

  setDisplayName(value: string): void {
    this.displayName = value;
  }

  setPassword(value: string): void {
    this.password = value;
  }

  setConfirm(value: string): void {
    this.confirm = value;
  }

  validate(): boolean {
    if (this.password !== this.confirm) {
      this.errors = { confirm: t.auth.passwordMismatch };
      return false;
    }
    const parsed = registerInputSchema.safeParse({
      email: this.email,
      password: this.password,
      displayName: this.displayName,
    });
    if (!parsed.success) {
      const next: RegisterFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'email' && next.email === undefined) next.email = t.auth.invalidEmail;
        if (key === 'displayName' && next.displayName === undefined) {
          next.displayName = t.auth.displayNameRequired;
        }
        if (key === 'password' && next.password === undefined) next.password = t.auth.passwordMin;
      }
      this.errors = next;
      return false;
    }
    this.errors = {};
    this.formError = null;
    return true;
  }

  async register(): Promise<boolean> {
    try {
      await this.auth.register({
        email: this.email,
        password: this.password,
        displayName: this.displayName,
      });
      return true;
    } catch (err) {
      this.formError = humanError(err);
      return false;
    }
  }
}
