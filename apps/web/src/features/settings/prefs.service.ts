import { Service } from '@rabjs/react';
import type { UpdateMeInput } from '@vital/dto';
import { client } from '@/api/client';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';

export class PrefsSectionService extends Service {
  error: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  async patch(
    input: Pick<UpdateMeInput, 'timezone' | 'weekStartsOn' | 'dailyModelCallLimit'>,
  ): Promise<void> {
    this.error = null;
    try {
      this.auth.setUser(await client.updateMe(input));
    } catch (err) {
      this.error = humanError(err);
    }
  }
}
