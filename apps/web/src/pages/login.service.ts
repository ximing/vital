import { loginInputSchema, type QrLoginTicket } from '@vital/dto';
import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { afterAuthPath } from '@/shell/require-auth';

export type LoginFieldErrors = { email?: string; password?: string };
export type QrLoginPhase = 'loading' | 'pending' | 'scanned' | 'expired' | 'cancelled' | 'error';
export type QrAdvance =
  | { kind: 'authed'; dest: string }
  | { kind: 'wait' }
  | { kind: 'again' }
  | { kind: 'stopped' };

export class LoginPageService extends Service {
  email = '';
  password = '';
  errors: LoginFieldErrors = {};
  formError: string | null = null;
  ticket: QrLoginTicket | null = null;
  qrStatus: QrLoginPhase = 'loading';
  qrError: string | null = null;
  private qrLock = false;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  /** One poll step. The page loops this until the phone confirms or the view unmounts. */
  async advanceQr(from: string | undefined, stopped: () => boolean): Promise<QrAdvance> {
    if (this.qrLock) return { kind: 'wait' };
    this.qrLock = true;
    try {
      return await this.stepQr(from, stopped);
    } finally {
      this.qrLock = false;
    }
  }

  private async stepQr(from: string | undefined, stopped: () => boolean): Promise<QrAdvance> {
    try {
      const ticket = this.ticket;
      const stale =
        ticket !== null &&
        this.qrStatus !== 'scanned' &&
        Date.parse(ticket.expiresAt) <= Date.now() + 2_000;
      if (ticket === null || stale) {
        const created = await client.createQrLogin();
        if (stopped()) return { kind: 'stopped' };
        this.ticket = created;
        this.qrStatus = 'pending';
        this.qrError = null;
      }
      const current = this.ticket;
      if (current === null) return { kind: 'wait' };
      const result = await client.pollQrLogin({ id: current.id, secret: current.secret });
      if (stopped()) return { kind: 'stopped' };
      if (result.status === 'confirmed' && result.user) {
        this.auth.themeService.setChoice(result.user.themePreference);
        this.auth.user = result.user;
        this.auth.status = 'ready';
        return { kind: 'authed', dest: afterAuthPath(from, result.user) };
      }
      if (result.status === 'expired' || result.status === 'cancelled') {
        this.ticket = null;
        this.qrStatus = result.status;
        return { kind: 'again' };
      }
      if (result.status === 'pending' || result.status === 'scanned') {
        this.qrStatus = result.status;
        this.qrError = null;
      }
      return { kind: 'wait' };
    } catch (err) {
      if (stopped()) return { kind: 'stopped' };
      this.qrError = humanError(err);
      this.qrStatus = 'error';
      return { kind: 'wait' };
    }
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
