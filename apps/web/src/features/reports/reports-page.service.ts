import type { Report, ReportEmbeds, ReportType } from '@vital/dto';
import { extractNotes, replaceNotes } from '@vital/dto';
import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { markOnboarding } from '@/features/onboarding/mark';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { QueryService } from '@/services/query.service';
import { applyRemoteBody, isDirty, isRevisionConflict } from './model';
import { reportKeys } from './queries';
import { ReportUiService } from './report-ui.service';

export type ReportSession = {
  id: string;
  draftMd: string;
  serverMd: string;
  draftTitle: string;
  serverTitle: string;
  revision: number;
  editorKey: number;
  conflict: boolean;
  blockSave: boolean;
  filling: boolean;
  remoteToast: boolean;
  saveError: string | null;
  saveState: 'idle' | 'saving' | 'saved';
};

function sessionFrom(report: Report, prev?: ReportSession | null): ReportSession {
  return {
    id: report.id,
    draftMd: report.bodyMd,
    serverMd: report.bodyMd,
    draftTitle: report.title,
    serverTitle: report.title,
    revision: report.revision,
    editorKey: (prev?.editorKey ?? 0) + 1,
    conflict: false,
    blockSave: false,
    filling: false,
    remoteToast: false,
    saveError: null,
    saveState: 'idle',
  };
}

export function sessionDirty(s: ReportSession): boolean {
  return isDirty(s.draftMd, s.serverMd) || s.draftTitle.trim() !== s.serverTitle.trim();
}

const GENERATE_WAIT_MS = 60_000;
const GENERATE_POLL_MS = 3_000;

export class ReportsPageService extends Service {
  session: ReportSession | null = null;
  generating = false;
  routeId = '';
  private saveInFlight: Promise<Report> | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get query(): QueryService {
    return this.resolve(QueryService);
  }

  get reportsUi(): ReportUiService {
    return this.resolve(ReportUiService);
  }

  get timeZone(): string {
    return this.auth.user?.timezone ?? 'UTC';
  }

  get weekStartsOn(): 0 | 1 {
    return this.auth.user?.weekStartsOn === 0 ? 0 : 1;
  }

  get dirty(): boolean {
    return this.session ? sessionDirty(this.session) : false;
  }

  setRouteId(id: string): void {
    if (this.routeId === id) return;
    this.routeId = id;
  }

  adoptReport(report: Report): void {
    if (this.session?.id === report.id) return;
    this.session = sessionFrom(report, this.session);
  }

  patchLive(fn: (s: ReportSession) => ReportSession): void {
    if (!this.session) return;
    this.session = fn(this.session);
  }

  commitSession(next: ReportSession | null): void {
    this.session = next;
  }

  cacheReport(report: Report, asCurrent = false): void {
    this.query.setQueryData(reportKeys.item(report.id), report);
    if (asCurrent) this.query.setQueryData(reportKeys.current(report.type), report);
  }

  async save(
    id: string,
    input: { revision: number; bodyMd?: string; title?: string },
  ): Promise<Report> {
    const report = await client.patchReport(id, input);
    this.cacheReport(report);
    void this.query.invalidate(reportKeys.list(report.type));
    void this.query.invalidate(['reports', 'overview']);
    void this.query.invalidate(reportKeys.review(id));
    if (report.type === 'weekly') await markOnboarding({ openedWeekly: true });
    if (report.type === 'daily') await markOnboarding({ wroteDaily: true });
    return report;
  }

  async loadCurrent(type: ReportType, at?: string): Promise<Report> {
    const report = await client.getCurrentReport(type, at);
    this.cacheReport(report, at === undefined);
    void this.query.invalidate(reportKeys.counts);
    return report;
  }

  async loadReport(id: string): Promise<Report> {
    const report = await client.getReport(id);
    this.cacheReport(report);
    return report;
  }

  async loadEmbeds(id: string): Promise<{ revision: number; embeds: ReportEmbeds }> {
    return client.getReportEmbeds(id);
  }

  refreshStats(type: ReportType, id?: string): void {
    void this.query.invalidate(['reports', 'overview']);
    if (id) void this.query.invalidate(reportKeys.review(id));
  }

  async runSave(): Promise<Report> {
    const live = this.session;
    if (!live) throw new Error('no session');
    const bodyChanged = isDirty(live.draftMd, live.serverMd);
    const titleChanged = live.draftTitle.trim() !== live.serverTitle.trim();
    this.patchLive((s) => ({ ...s, saveState: 'saving', saveError: null }));
    try {
      const saved = await this.save(live.id, {
        revision: live.revision,
        ...(bodyChanged ? { bodyMd: live.draftMd } : {}),
        ...(titleChanged ? { title: live.draftTitle.trim() } : {}),
      });
      const current = this.session;
      if (current && current.id === live.id) {
        this.commitSession({
          ...current,
          revision: saved.revision,
          serverMd:
            bodyChanged && !isDirty(current.draftMd, live.draftMd)
              ? live.draftMd
              : current.serverMd,
          serverTitle: titleChanged ? live.draftTitle.trim() : current.serverTitle,
          saveState: 'saved',
        });
      }
      this.reportsUi.mergeEmbeds(saved.embeds);
      return saved;
    } catch (err) {
      if (isRevisionConflict(err)) {
        this.patchLive((s) => ({
          ...s,
          conflict: true,
          blockSave: true,
          filling: false,
          saveState: 'idle',
        }));
      } else {
        this.patchLive((s) => ({ ...s, saveError: humanError(err), saveState: 'idle' }));
      }
      throw err;
    }
  }

  async runSaveTracked(): Promise<Report> {
    if (this.saveInFlight) return this.saveInFlight;
    const promise = this.runSave().finally(() => {
      if (this.saveInFlight === promise) this.saveInFlight = null;
    });
    this.saveInFlight = promise;
    return promise;
  }

  awaitSaveInFlight(): Promise<Report | void> {
    return this.saveInFlight ?? Promise.resolve();
  }

  async switchPeriod(next: ReportType, at: string | undefined): Promise<Report | null> {
    try {
      if (this.saveInFlight) await this.saveInFlight;
      const live = this.session;
      if (
        live &&
        live.id === this.routeId &&
        sessionDirty(live) &&
        !live.conflict &&
        !live.blockSave
      ) {
        await this.runSaveTracked();
      }
      return await this.loadCurrent(next, at);
    } catch (err) {
      if (isRevisionConflict(err)) {
        this.patchLive((s) => ({ ...s, conflict: true, blockSave: true }));
      } else {
        this.patchLive((s) => ({ ...s, saveError: humanError(err) }));
      }
      return null;
    }
  }

  async generate(liveType: ReportType): Promise<void> {
    const live = this.session;
    if (!live || live.filling || this.generating || liveType !== 'daily') return;
    if (sessionDirty(live)) {
      try {
        await this.runSaveTracked();
      } catch {
        return;
      }
    }
    const reportId = live.id;
    const baseline = extractNotes((this.session ?? live).serverMd, 'daily');
    this.patchLive((s) => ({ ...s, filling: true, saveError: null }));
    this.generating = true;
    try {
      const queued = await client.generateReport(reportId);
      if (queued.status === 'disabled') {
        this.patchLive((s) => ({ ...s, filling: false, saveError: t.reports.generateDisabled }));
        return;
      }
      const started = Date.now();
      while (true) {
        if (this.routeId !== reportId) {
          return;
        }
        const remote = await this.loadReport(reportId);
        if (extractNotes(remote.bodyMd, 'daily') !== baseline) {
          this.commitSession({ ...sessionFrom(remote, this.session), filling: false });
          this.reportsUi.setEmbeds(remote.embeds);
          this.refreshStats('daily', reportId);
          void markOnboarding({ wroteDaily: true });
          return;
        }
        if (Date.now() - started >= GENERATE_WAIT_MS) break;
        await new Promise((resolve) => setTimeout(resolve, GENERATE_POLL_MS));
      }
      this.patchLive((s) => ({ ...s, filling: false, saveError: t.reports.generateTimeout }));
    } catch (err) {
      this.patchLive((s) => ({ ...s, filling: false, saveError: humanError(err) }));
    } finally {
      this.generating = false;
    }
  }

  async reloadRemote(): Promise<void> {
    if (this.routeId === '') return;
    try {
      const remote = await this.loadReport(this.routeId);
      this.commitSession(sessionFrom(remote, this.session));
      this.reportsUi.setEmbeds(remote.embeds);
    } catch (err) {
      this.patchLive((s) => ({ ...s, saveError: humanError(err) }));
    }
  }

  applyRemoteBody(remote: Report): void {
    const body = applyRemoteBody(this.dirty, this.session?.draftMd ?? '', remote.bodyMd);
    if (body !== remote.bodyMd) return;
    this.commitSession(sessionFrom(remote, this.session));
    this.reportsUi.setEmbeds(remote.embeds);
  }

  async applyRemoteToast(reportId: string, revision: number): Promise<void> {
    if (this.saveInFlight) await this.saveInFlight.catch(() => undefined);
    const live = this.session;
    if (live && live.id === reportId && revision > live.revision) {
      this.patchLive((s) => ({ ...s, remoteToast: true }));
    }
  }

  async toggleTask(taskId: string, liveType: ReportType): Promise<void> {
    const embed = this.reportsUi.embeds.tasks[taskId];
    if (!embed || embed.deletedAt !== null) return;
    try {
      if (embed.status === 'done') {
        const completionId = this.reportsUi.lastCompletionId[taskId];
        if (completionId === undefined) return;
        await client.uncompleteTask(taskId, { completionId });
      } else {
        const res = await client.completeTask(taskId);
        this.reportsUi.setCompletionId(taskId, res.undo.completionId);
      }
      if (this.routeId !== '') {
        const res = await this.loadEmbeds(this.routeId);
        this.reportsUi.mergeEmbeds(res.embeds);
      }
      this.refreshStats(liveType, this.routeId);
    } catch (err) {
      this.patchLive((s) => ({ ...s, saveError: humanError(err) }));
    }
  }

  hydrateNotes(md: string, liveType: ReportType): void {
    this.patchLive((s) => {
      const draftMd = replaceNotes(s.draftMd, liveType, md);
      const wasDirty = sessionDirty({ ...s, draftMd });
      return { ...s, draftMd, serverMd: wasDirty ? s.serverMd : draftMd };
    });
  }

  async toggleReviewTask(
    task: { taskId: string; completionId: string | null },
    liveType: ReportType,
  ): Promise<void> {
    try {
      if (task.completionId) {
        await client.uncompleteTask(task.taskId, { completionId: task.completionId });
      } else {
        await client.completeTask(task.taskId);
      }
      if (this.routeId !== '') {
        const res = await this.loadEmbeds(this.routeId);
        this.reportsUi.mergeEmbeds(res.embeds);
      }
      this.refreshStats(liveType, this.routeId);
    } catch (err) {
      this.patchLive((s) => ({ ...s, saveError: humanError(err) }));
    }
  }
}
