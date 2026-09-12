import { Service } from '@rabjs/react';
import { loginInputSchema, type UserProfile } from '@vital/dto';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';

export class LoginService extends Service {
  email = '';
  password = '';
  error: string | null = null;
  busy = false;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  setEmail(email: string): void {
    this.email = email;
  }

  setPassword(password: string): void {
    this.password = password;
  }

  async submit(): Promise<UserProfile | null> {
    const parsed = loginInputSchema.safeParse({ email: this.email, password: this.password });
    if (!parsed.success) {
      this.error = copy.auth.invalidLogin;
      return null;
    }
    this.error = null;
    this.busy = true;
    try {
      return await this.auth.login(parsed.data);
    } catch (err) {
      this.error = humanError(err);
      return null;
    } finally {
      this.busy = false;
    }
  }
}
