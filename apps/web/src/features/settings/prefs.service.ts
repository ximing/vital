import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';

export class PrefsSectionService extends Service {
  error: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  async patch(input: { timezone?: string; weekStartsOn?: 0 | 1 }): Promise<void> {
    this.error = null;
    try {
      this.auth.setUser(await client.updateMe(input));
    } catch (err) {
      this.error = humanError(err);
    }
  }
}
