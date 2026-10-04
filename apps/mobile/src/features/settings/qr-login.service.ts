import { Service } from '@rabjs/react';
import { parseQrLoginPayload, type QrLoginTicketInput } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';

export class QrLoginScanService extends Service {
  open = false;
  phase: 'scan' | 'confirm' = 'scan';
  busy = false;
  error: string | null = null;
  ticket: QrLoginTicketInput | null = null;
  private lockedUntil = 0;

  show(): void {
    this.reset();
    this.open = true;
  }

  private reset(): void {
    this.phase = 'scan';
    this.busy = false;
    this.error = null;
    this.ticket = null;
    this.lockedUntil = 0;
  }

  async dismiss(): Promise<void> {
    const ticket = this.phase === 'confirm' ? this.ticket : null;
    this.reset();
    this.open = false;
    if (ticket) await client.cancelQrLogin(ticket).catch(() => undefined);
  }

  async onCode(raw: string): Promise<void> {
    if (!this.open || this.phase !== 'scan' || this.busy || Date.now() < this.lockedUntil) return;
    const parsed = parseQrLoginPayload(raw);
    if (!parsed) {
      this.error = copy.me.scanInvalid;
      this.lockedUntil = Date.now() + 1_200;
      return;
    }
    this.busy = true;
    this.error = null;
    try {
      const result = await client.scanQrLogin(parsed);
      if (result.status === 'confirmed') {
        toast(copy.me.scanDone);
        this.reset();
        this.open = false;
        return;
      }
      this.ticket = parsed;
      this.phase = 'confirm';
    } catch (err) {
      this.error = humanError(err);
      this.lockedUntil = Date.now() + 1_200;
    } finally {
      this.busy = false;
    }
  }

  async confirm(): Promise<void> {
    const ticket = this.ticket;
    if (!ticket || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      await client.confirmQrLogin(ticket);
      toast(copy.me.scanDone);
      this.reset();
      this.open = false;
    } catch (err) {
      this.error = humanError(err);
      this.busy = false;
    }
  }
}
