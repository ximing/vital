import { Service } from '@rabjs/react';
import { registerInputSchema } from '@vital/dto';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';

export class RegisterService extends Service {
  displayName = '';
  email = '';
  password = '';
  error: string | null = null;
  busy = false;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  setDisplayName(value: string): void {
    this.displayName = value;
  }

  setEmail(email: string): void {
    this.email = email;
  }

  setPassword(password: string): void {
    this.password = password;
  }

  async submit(): Promise<boolean> {
    const parsed = registerInputSchema.safeParse({
      displayName: this.displayName,
      email: this.email,
      password: this.password,
    });
    if (!parsed.success) {
      this.error = copy.auth.invalidRegister;
      return false;
    }
    this.error = null;
    this.busy = true;
    try {
      await this.auth.register(parsed.data);
      return true;
    } catch (err) {
      this.error = humanError(err);
      return false;
    } finally {
      this.busy = false;
    }
  }
}
