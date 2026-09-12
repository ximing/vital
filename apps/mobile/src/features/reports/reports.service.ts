import { Service } from '@rabjs/react';
import type { ReportOverview, ReportReview, ReportType } from '@vital/dto';
import { client } from '../../lib/api';
import { humanError, isNetworkError } from '../../lib/errors';
import { markOnboarding } from '../../lib/onboarding';
import { pullSync, subscribeSync } from '../../lib/sync';
import { AuthService } from '../../services/auth.service';
import type { ReportBarState } from './ReportBar';

/** 子容器 ReportEditorService 挂上来，列表页即可 save/fill/generate，不必 forwardRef。 */
export type ReportEditorHost = {
  save: () => Promise<void>;
  load: () => Promise<void>;
  fill: () => Promise<void>;
  generate: () => Promise<void>;
  readonly barState: ReportBarState;
  readonly review: ReportReview | null;
};

export class ReportsService extends Service {
  type: ReportType = 'daily';
  data: ReportOverview | null = null;
  error: string | null = null;
  offline = false;
  loading = true;
  refreshing = false;
  reportId: string | null = null;
  pickerOpen = false;
  editor: ReportEditorHost | null = null;

  private primed = false;
  private unsubSync: (() => void) | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  start(): void {
    if (this.unsubSync) return;
    this.unsubSync = subscribeSync((changes) => {
      if (changes.tasks.length === 0 && changes.inbox.length === 0 && changes.reports.length === 0) {
        return;
      }
      void this.load(this.type);
    });
  }

  stop(): void {
    this.unsubSync?.();
    this.unsubSync = null;
  }

  async load(nextType: ReportType, at?: string): Promise<void> {
    this.loading = true;
    try {
      const [overview, current] = await Promise.all([
        client.getReportOverview(nextType, at),
        client.getCurrentReport(nextType, at),
      ]);
      this.data = overview;
      this.reportId = current.id;
      if (nextType === 'weekly') {
        await markOnboarding(this.auth.user, (next) => this.auth.refreshUser(next), { openedWeekly: true });
      }
      this.error = null;
      this.offline = false;
    } catch (err) {
      this.error = humanError(err);
      this.offline = isNetworkError(err);
    } finally {
      this.loading = false;
    }
  }

  async reloadFromFocus(): Promise<void> {
    await pullSync().catch(() => undefined);
    if (!this.primed) {
      this.primed = true;
      await this.load(this.type);
    }
  }

  async switchType(next: ReportType): Promise<void> {
    if (next === this.type) return;
    await this.editor?.save().catch(() => undefined);
    this.type = next;
    await this.load(next);
  }

  async openPeriod(at?: string): Promise<void> {
    await this.editor?.save().catch(() => undefined);
    try {
      await this.load(this.type, at);
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      await pullSync().catch(() => undefined);
      await this.load(this.type);
      await this.editor?.load().catch(() => undefined);
    } finally {
      this.refreshing = false;
    }
  }

  attachEditor(editor: ReportEditorHost): void {
    this.editor = editor;
  }

  detachEditor(editor: ReportEditorHost): void {
    if (this.editor === editor) this.editor = null;
  }

  openPicker(): void {
    this.pickerOpen = true;
  }

  closePicker(): void {
    this.pickerOpen = false;
  }
}
