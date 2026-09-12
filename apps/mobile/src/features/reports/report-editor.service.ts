import { Service } from '@rabjs/react';
import { ApiError } from '@vital/api-client';
import type { EntityKind } from '@vital/markdown';
import {
  extractNotes,
  replaceNotes,
  type Report,
  type ReportCarriedTask,
  type ReportEmbeds,
  type ReportReview,
  type SyncHead,
  type TaskStatus,
} from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { markOnboarding } from '../../lib/onboarding';
import { subscribeSync } from '../../lib/sync';
import { AuthService } from '../../services/auth.service';
import type { ReportBarState } from './ReportBar';
import { insertToken, runReportFocusSync } from './report-sync';
import { ReportsService } from './reports.service';

const AUTOSAVE_MS = 2_500;
const GENERATE_WAIT_MS = 60_000;
const GENERATE_POLL_MS = 3_000;

export type ReviewKey = 'completed' | 'carried' | 'captured';

export class ReportEditorService extends Service {
  reportId = '';
  report: Report | null = null;
  draftMd = '';
  draftTitle = '';
  embeds: ReportEmbeds | null = null;
  review: ReportReview | null = null;
  error: string | null = null;
  saveState: 'idle' | 'saving' | 'saved' = 'idle';
  saveError: string | null = null;
  lastSavedAt: number | null = null;
  conflict = false;
  blockSave = false;
  busy = false;
  editingBody = false;
  insertKind: EntityKind | null = null;
  collapsed: Record<ReviewKey, boolean> = {
    completed: true,
    carried: true,
    captured: true,
  };

  private syncHead: SyncHead | null = null;
  private saving = false;
  private filling = false;
  private unsubSync: (() => void) | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get dirty(): boolean {
    const report = this.report;
    if (report === null) return false;
    return this.draftMd !== report.bodyMd || this.draftTitle.trim() !== report.title.trim();
  }

  get barState(): ReportBarState {
    return {
      saveState: this.saveState,
      dirty: this.dirty,
      lastSavedAt: this.lastSavedAt,
      busy: this.busy,
      conflict: this.conflict,
      type: this.report?.type ?? null,
    };
  }

  get notes(): string {
    if (this.report === null) return '';
    return extractNotes(this.draftMd, this.report.type);
  }

  configure(reportId: string): void {
    if (this.reportId === reportId) return;
    this.reportId = reportId;
    this.report = null;
    this.draftMd = '';
    this.draftTitle = '';
    this.embeds = null;
    this.review = null;
    this.error = null;
    this.saveState = 'idle';
    this.saveError = null;
    this.lastSavedAt = null;
    this.conflict = false;
    this.blockSave = false;
    this.busy = false;
    this.editingBody = false;
    this.insertKind = null;
    this.collapsed = { completed: true, carried: true, captured: true };
    this.syncHead = null;
    this.saving = false;
    this.filling = false;
    this.clearAutosave();
  }

  start(): void {
    this.attachParent();
    if (this.unsubSync) return;
    this.unsubSync = subscribeSync((changes) => {
      const mine = changes.reports.some((row) => row.id === this.reportId);
      if (!mine && changes.tasks.length === 0 && changes.inbox.length === 0) return;
      void this.load();
    });
  }

  stop(): void {
    this.detachParent();
    this.unsubSync?.();
    this.unsubSync = null;
    this.clearAutosave();
  }

  private attachParent(): void {
    this.parentReports()?.attachEditor(this);
  }

  private detachParent(): void {
    this.parentReports()?.detachEditor(this);
  }

  private parentReports(): ReportsService | null {
    try {
      return this.resolve(ReportsService);
    } catch {
      return null;
    }
  }

  applyReport(next: Report): void {
    this.report = next;
    this.draftMd = next.bodyMd;
    this.draftTitle = next.title;
    this.embeds = next.embeds;
  }

  writeDraft(next: { md?: string; title?: string }): void {
    if (next.md !== undefined) this.draftMd = next.md;
    if (next.title !== undefined) this.draftTitle = next.title;
    this.scheduleAutosave();
  }

  setEditingBody(value: boolean): void {
    this.editingBody = value;
  }

  openInsert(kind: EntityKind): void {
    this.insertKind = kind;
  }

  closeInsert(): void {
    this.insertKind = null;
  }

  insert(token: `[[${EntityKind}:${string}]]`): void {
    this.writeDraft({ md: insertToken(this.draftMd, token) });
  }

  writeNotes(next: string): void {
    if (this.report === null) return;
    this.writeDraft({ md: replaceNotes(this.draftMd, this.report.type, next) });
  }

  toggleSection(key: ReviewKey): void {
    this.collapsed = { ...this.collapsed, [key]: !this.collapsed[key] };
  }

  async load(): Promise<void> {
    if (this.reportId === '') return;
    try {
      const current = this.report;
      const dirtyNow =
        current !== null &&
        (this.draftMd !== current.bodyMd || this.draftTitle.trim() !== current.title.trim());
      const result = await runReportFocusSync(
        {
          syncHead: () => client.syncHead(),
          getReport: (id) => client.getReport(id),
          getEmbeds: (id) => client.getReportEmbeds(id),
        },
        {
          reportId: this.reportId,
          hasReport: current !== null,
          dirty: dirtyNow,
          prevHead: this.syncHead,
        },
      );
      if (result.head !== null) this.syncHead = result.head;
      if (result.report !== undefined) {
        const stillDirty =
          this.draftMd !== (this.report?.bodyMd ?? '') ||
          this.draftTitle.trim() !== (this.report?.title ?? '').trim();
        if (!stillDirty) this.applyReport(result.report);
      }
      if (result.embeds !== undefined) this.embeds = result.embeds;
      if (result.toastRemote) toast(copy.toast.remoteUpdated);
      this.review = await client.getReportReview(this.reportId);
      this.error = null;
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async save(): Promise<void> {
    const live = this.report;
    if (live === null || this.saving) return;
    if (this.conflict || this.blockSave || this.filling) return;
    const bodyChanged = this.draftMd !== live.bodyMd;
    const title = this.draftTitle.trim();
    const titleChanged = title !== live.title.trim() && title !== '';
    if (!bodyChanged && !titleChanged) return;
    this.saving = true;
    this.saveState = 'saving';
    this.saveError = null;
    const payloadMd = this.draftMd;
    try {
      const saved = await client.patchReport(live.id, {
        revision: live.revision,
        ...(bodyChanged ? { bodyMd: payloadMd } : {}),
        ...(titleChanged ? { title } : {}),
      });
      this.report = saved;
      this.embeds = saved.embeds;
      this.lastSavedAt = Date.now();
      this.saveState =
        this.draftMd === payloadMd && this.draftTitle.trim() === title ? 'saved' : 'idle';
      if (saved.type === 'daily') {
        await markOnboarding(this.auth.user, (next) => this.auth.refreshUser(next), { wroteDaily: true });
      }
      if (saved.type === 'weekly') {
        await markOnboarding(this.auth.user, (next) => this.auth.refreshUser(next), { openedWeekly: true });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REPORT_REVISION_CONFLICT') {
        this.conflict = true;
        this.blockSave = true;
      } else {
        this.saveError = humanError(err);
      }
      this.saveState = 'idle';
    } finally {
      this.saving = false;
      this.scheduleAutosave();
    }
  }

  async fill(): Promise<void> {
    const live = this.report;
    if (live === null) return;
    this.busy = true;
    try {
      const next = await client.fillReport(live.id, { revision: live.revision });
      this.applyReport(next);
      this.lastSavedAt = Date.now();
      this.saveState = 'saved';
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REPORT_REVISION_CONFLICT') {
        this.conflict = true;
        this.blockSave = true;
      } else {
        toast(humanError(err));
      }
    } finally {
      this.busy = false;
      this.scheduleAutosave();
    }
  }

  async generate(): Promise<void> {
    const live = this.report;
    if (live === null || live.type !== 'daily') return;
    this.busy = true;
    try {
      await this.save();
      const queued = await client.generateReport(live.id);
      if (queued.status === 'disabled') {
        toast(copy.reports.generateDisabled);
        return;
      }
      this.filling = true;
      const baseline = extractNotes(this.report?.bodyMd ?? '', 'daily');
      const started = Date.now();
      while (Date.now() - started < GENERATE_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, GENERATE_POLL_MS));
        if (this.reportId !== live.id) return;
        const next = await client.getReport(live.id);
        if (extractNotes(next.bodyMd, 'daily') !== baseline) {
          this.applyReport(next);
          this.lastSavedAt = Date.now();
          this.saveState = 'saved';
          toast(copy.reports.generated);
          await markOnboarding(this.auth.user, (nextUser) => this.auth.refreshUser(nextUser), {
            wroteDaily: true,
          });
          return;
        }
      }
      toast(copy.reports.generateTimeout);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.filling = false;
      this.busy = false;
      this.scheduleAutosave();
    }
  }

  async resolveConflict(mode: 'reload' | 'keep'): Promise<void> {
    if (mode === 'keep') {
      this.conflict = false;
      this.blockSave = true;
      this.clearAutosave();
      return;
    }
    try {
      const remote = await client.getReport(this.reportId);
      this.applyReport(remote);
      this.conflict = false;
      this.blockSave = false;
      this.saveState = 'saved';
      this.lastSavedAt = Date.now();
    } catch (err) {
      toast(humanError(err));
    }
  }

  async toggleReviewTask(item: ReportCarriedTask): Promise<void> {
    try {
      if (item.completionId) {
        await client.uncompleteTask(item.taskId, { completionId: item.completionId });
      } else {
        await client.completeTask(item.taskId);
      }
      this.review = await client.getReportReview(this.reportId);
    } catch (err) {
      toast(humanError(err));
    }
  }

  async toggleEmbedTask(id: string, status: TaskStatus, openTask: (id: string) => void): Promise<void> {
    if (status === 'done') {
      openTask(id);
      return;
    }
    try {
      await client.completeTask(id);
      const res = await client.getReportEmbeds(this.reportId);
      this.embeds = res.embeds;
      this.review = await client.getReportReview(this.reportId);
    } catch (err) {
      toast(humanError(err));
    }
  }

  private scheduleAutosave(): void {
    this.clearAutosave();
    if (!this.dirty || this.conflict || this.blockSave || this.busy) return;
    this.autosaveTimer = setTimeout(() => {
      void this.save();
    }, AUTOSAVE_MS);
  }

  private clearAutosave(): void {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }
}
