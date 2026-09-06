import type { Report, ReportReviewTask, ReportType, SyncHead } from '@vital/dto';
import { extractNotes, replaceNotes } from '@vital/dto';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { useOnline } from '@/features/inbox/online';
import { markOnboarding } from '@/features/onboarding/mark';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import {
  applyRemoteBody,
  decidePoll,
  isDirty,
  isRevisionConflict,
  parseReportType,
  POLL_MS,
  reportHref,
  SAVE_DEBOUNCE_MS,
} from './model';
import { useReportActions, useReportQuery, useReportReviewQuery } from './queries';
import { useAuth } from '@/services/auth.service';
import { ReportsCalendar } from './ReportsCalendar';
import { ReportsOverview } from './Overview';
import { ReviewLists } from './ReviewLists';
import { reportUi } from './report-ui.service';
import { WysiwygEditor } from './WysiwygEditor';

type Session = {
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

function sessionFrom(report: Report, prev?: Session | null): Session {
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

function sessionDirty(s: Session): boolean {
  return isDirty(s.draftMd, s.serverMd) || s.draftTitle.trim() !== s.serverTitle.trim();
}

export function ReportsWorkspace() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const typeParam = parseReportType(search.get('type'));
  const online = useOnline();
  const actions = useReportActions();
  const user = useAuth((s) => s.user);
  const timeZone = user?.timezone ?? 'UTC';
  const weekStartsOn = user?.weekStartsOn === 0 ? 0 : 1;

  const reportQuery = useReportQuery(id, id !== '');
  const reviewQuery = useReportReviewQuery(id, id !== '');
  const liveType: ReportType = reportQuery.data?.type ?? typeParam;

  useEffect(() => {
    if (liveType === 'weekly') void markOnboarding({ openedWeekly: true });
  }, [liveType]);

  const [session, setSession] = useState<Session | null>(null);
  const report = reportQuery.data && reportQuery.data.id === id ? reportQuery.data : undefined;
  if (report && session?.id !== report.id) {
    setSession(sessionFrom(report, session));
  }

  useEffect(() => {
    if (!report || session?.id !== report.id) return;
    reportUi().setEmbeds(report.embeds);
  }, [report, session?.id]);

  const dirty = session ? sessionDirty(session) : false;
  const dirtyRef = useRef(false);
  const draftMdRef = useRef('');
  const idRef = useRef(id);
  const sessionRef = useRef(session);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef<Promise<Report> | null>(null);
  const fillingRef = useRef(false);
  const saveFnRef = useRef(actions.save);
  const runSaveTrackedRef = useRef<((live: Session) => Promise<Report>) | undefined>(undefined);

  useEffect(() => {
    dirtyRef.current = dirty;
    draftMdRef.current = session?.draftMd ?? '';
    idRef.current = id;
    sessionRef.current = session;
    saveFnRef.current = actions.save;
  });

  function commitSession(next: Session | null): void {
    sessionRef.current = next;
    dirtyRef.current = next ? sessionDirty(next) : false;
    draftMdRef.current = next?.draftMd ?? '';
    fillingRef.current = next?.filling === true;
    if (next) idRef.current = next.id;
    setSession(next);
  }

  function patchLive(fn: (s: Session) => Session): void {
    const live = sessionRef.current;
    if (!live) return;
    commitSession(fn(live));
  }

  function cancelSaveTimer(): void {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (id === '' || !online) return;
    let cancelled = false;
    let prev: SyncHead | null = null;

    async function tick(): Promise<void> {
      try {
        const head = await client.syncHead();
        if (cancelled) return;
        const dirtyNow = dirtyRef.current;
        const action = decidePoll(prev, head, dirtyNow);
        prev = head;
        const reportId = idRef.current;
        if (reportId === '') return;
        if (action.reloadBody) {
          const remote = await client.getReport(reportId);
          if (cancelled || dirtyRef.current || fillingRef.current) return;
          const body = applyRemoteBody(dirtyRef.current, draftMdRef.current, remote.bodyMd);
          if (body !== remote.bodyMd) return;
          const next = sessionFrom(remote, sessionRef.current);
          sessionRef.current = next;
          dirtyRef.current = false;
          draftMdRef.current = next.draftMd;
          fillingRef.current = false;
          setSession(next);
          reportUi().setEmbeds(remote.embeds);
          return;
        }
        if (action.fetchEmbeds) {
          const res = await client.getReportEmbeds(reportId);
          if (cancelled || fillingRef.current) return;
          reportUi().mergeEmbeds(res.embeds);
        }
        if (action.toastRemote && !fillingRef.current) {
          const live = sessionRef.current;
          if (live) {
            const next = { ...live, remoteToast: true };
            sessionRef.current = next;
            setSession(next);
          }
        }
      } catch {
        // Poll is best-effort.
      }
    }

    const timer = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, online]);

  async function runSave(live: Session): Promise<Report> {
    const bodyChanged = isDirty(live.draftMd, live.serverMd);
    const titleChanged = live.draftTitle.trim() !== live.serverTitle.trim();
    patchLive((s) => ({ ...s, saveState: 'saving', saveError: null }));
    try {
      const saved = await saveFnRef.current(live.id, {
        revision: live.revision,
        ...(bodyChanged ? { bodyMd: live.draftMd } : {}),
        ...(titleChanged ? { title: live.draftTitle.trim() } : {}),
      });
      const current = sessionRef.current;
      if (current && current.id === live.id) {
        commitSession({
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
      reportUi().mergeEmbeds(saved.embeds);
      return saved;
    } catch (err) {
      if (isRevisionConflict(err)) {
        patchLive((s) => ({
          ...s,
          conflict: true,
          blockSave: true,
          filling: false,
          saveState: 'idle',
        }));
        fillingRef.current = false;
      } else {
        patchLive((s) => ({ ...s, saveError: humanError(err), saveState: 'idle' }));
      }
      throw err;
    }
  }

  async function runSaveTracked(live: Session): Promise<Report> {
    const existing = saveInFlightRef.current;
    if (existing) return existing;
    const promise = runSave(live).finally(() => {
      if (saveInFlightRef.current === promise) saveInFlightRef.current = null;
    });
    saveInFlightRef.current = promise;
    return promise;
  }

  useEffect(() => {
    runSaveTrackedRef.current = runSaveTracked;
  });

  useEffect(() => {
    const live = sessionRef.current;
    if (!live || live.id !== id || !online || live.conflict || live.blockSave) return;
    if (fillingRef.current || live.filling) return;
    if (!sessionDirty(live)) return;
    const timer = setTimeout(() => {
      if (saveTimerRef.current === timer) saveTimerRef.current = null;
      if (fillingRef.current) return;
      const now = sessionRef.current;
      if (!now || now.id !== id || now.conflict || now.blockSave || !sessionDirty(now)) return;
      void runSaveTrackedRef.current?.(now).catch(() => undefined);
    }, SAVE_DEBOUNCE_MS);
    saveTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (saveTimerRef.current === timer) saveTimerRef.current = null;
    };
  }, [
    id,
    online,
    session?.id,
    session?.draftMd,
    session?.draftTitle,
    session?.serverMd,
    session?.serverTitle,
    session?.revision,
    session?.conflict,
    session?.blockSave,
    session?.filling,
  ]);

  async function openPeriod(next: ReportType, at?: string): Promise<void> {
    cancelSaveTimer();
    try {
      if (saveInFlightRef.current) await saveInFlightRef.current;
      const live = sessionRef.current;
      if (live && live.id === id && sessionDirty(live) && !live.conflict && !live.blockSave) {
        await runSaveTracked(live);
      }
      const current = await actions.loadCurrent(next, at);
      navigate(reportHref(current.id, current.type));
    } catch (err) {
      if (isRevisionConflict(err)) {
        patchLive((s) => ({ ...s, conflict: true, blockSave: true }));
      } else {
        patchLive((s) => ({ ...s, saveError: humanError(err) }));
      }
    }
  }

  async function reloadRemote(): Promise<void> {
    if (id === '') return;
    try {
      const remote = await actions.loadReport(id);
      fillingRef.current = false;
      commitSession(sessionFrom(remote, sessionRef.current));
      reportUi().setEmbeds(remote.embeds);
    } catch (err) {
      patchLive((s) => ({ ...s, saveError: humanError(err) }));
    }
  }

  async function toggleTask(taskId: string): Promise<void> {
    const embed = reportUi().embeds.tasks[taskId];
    if (!embed || embed.deletedAt !== null) return;
    try {
      if (embed.status === 'done') {
        const completionId = reportUi().lastCompletionId[taskId];
        if (completionId === undefined) return;
        await client.uncompleteTask(taskId, { completionId });
      } else {
        const res = await client.completeTask(taskId);
        reportUi().setCompletionId(taskId, res.undo.completionId);
      }
      if (id !== '') {
        const res = await actions.loadEmbeds(id);
        reportUi().mergeEmbeds(res.embeds);
      }
      actions.refreshStats(liveType, id);
    } catch (err) {
      patchLive((s) => ({ ...s, saveError: humanError(err) }));
    }
  }

  function handleHydrate(md: string): void {
    patchLive((s) => {
      const draftMd = replaceNotes(s.draftMd, liveType, md);
      const wasDirty = sessionDirty({ ...s, draftMd });
      return { ...s, draftMd, serverMd: wasDirty ? s.serverMd : draftMd };
    });
  }

  async function toggleReviewTask(task: ReportReviewTask): Promise<void> {
    try {
      if (task.completionId) {
        await client.uncompleteTask(task.taskId, { completionId: task.completionId });
      } else {
        await client.completeTask(task.taskId);
      }
      if (id !== '') {
        const res = await actions.loadEmbeds(id);
        reportUi().mergeEmbeds(res.embeds);
      }
      actions.refreshStats(liveType, id);
    } catch (err) {
      patchLive((s) => ({ ...s, saveError: humanError(err) }));
    }
  }

  const loading = id !== '' && reportQuery.isLoading && session?.id !== id;
  const error = id === '' ? null : reportQuery.error;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col lg:flex-row">
      <main
        id="main"
        data-region="reflection-canvas"
        className="order-2 flex min-h-0 min-w-0 flex-1 flex-col bg-canvas lg:order-1"
      >
        <div className="flex w-full max-w-[45rem] flex-1 flex-col">
          <header className="flex shrink-0 items-end justify-between gap-3 pb-2">
            <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
              {t.reports.kicker}
            </p>
            <span className="text-[length:var(--text-caption)] text-muted" role="status">
              {session?.saveState === 'saving'
                ? t.reports.saving
                : session?.saveState === 'saved' && !dirty
                  ? t.reports.saved
                  : null}
            </span>
          </header>

          {!online ? (
            <div className="pt-2">
              <Banner>{t.todos.offline}</Banner>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-center gap-3 py-2">
              <Banner>{humanError(error)}</Banner>
              <Button
                variant="ghost"
                onClick={() => {
                  void reportQuery.refetch();
                  void reviewQuery.refetch();
                }}
              >
                {t.reports.retry}
              </Button>
            </div>
          ) : null}

          {session?.saveError ? (
            <div className="py-2">
              <Banner>{session.saveError}</Banner>
            </div>
          ) : null}

          {session?.conflict ? (
            <div className="flex flex-wrap items-center gap-3 py-2">
              <Banner>{t.reports.conflict}</Banner>
              <Button variant="ghost" onClick={() => void reloadRemote()}>
                {t.reports.reload}
              </Button>
              <Button
                variant="quiet"
                onClick={() => patchLive((s) => ({ ...s, conflict: false, blockSave: true }))}
              >
                {t.reports.keepLocal}
              </Button>
            </div>
          ) : null}

          {session?.remoteToast && !session.conflict ? (
            <div className="flex flex-wrap items-center gap-3 py-2" role="status">
              <p className="text-[length:var(--text-meta)] text-muted">{t.reports.remoteUpdated}</p>
              <Button variant="ghost" onClick={() => void reloadRemote()}>
                {t.reports.reload}
              </Button>
            </div>
          ) : null}

          {id === '' ? (
            <ReportsOverview type={typeParam} onPick={(ymd) => void openPeriod(typeParam, ymd)} />
          ) : loading || !session || session.id !== id ? (
            <div className="flex-1 py-10" aria-busy="true" aria-label={t.reports.loading}>
              <div className="skeleton-pulse mb-4 h-10 rounded-lg" />
              <div className="skeleton-pulse mb-8 h-32 rounded-lg" />
              <div className="skeleton-pulse h-64 rounded-lg" />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-8 pt-4">
              <input
                aria-label={t.reports.title}
                value={session.draftTitle}
                disabled={!online || session.filling}
                onChange={(event) => patchLive((s) => ({ ...s, draftTitle: event.target.value }))}
                className="w-full shrink-0 bg-transparent text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em] text-fg outline-none"
              />
              {reviewQuery.data ? (
                <ReviewLists
                  review={reviewQuery.data}
                  onToggleTask={(task) => void toggleReviewTask(task)}
                  onOpenTask={(taskId) => navigate(`/todos/lists/smart:today?task=${taskId}`)}
                  onOpenInbox={(inboxId) => navigate(`/inbox/${inboxId}`)}
                />
              ) : (
                <div className="skeleton-pulse h-24 rounded-lg" aria-busy="true" />
              )}
              <div className="report-paper flex min-h-[16rem] min-w-0 flex-1 flex-col">
                <WysiwygEditor
                  key={`${session.id}:${session.editorKey}`}
                  reportId={session.id}
                  bodyMd={extractNotes(session.draftMd, liveType)}
                  editable={online && !session.filling}
                  onChange={(md) =>
                    patchLive((s) => ({ ...s, draftMd: replaceNotes(s.draftMd, liveType, md) }))
                  }
                  onHydrate={handleHydrate}
                  onToggleTask={(taskId) => void toggleTask(taskId)}
                />
              </div>
            </div>
          )}
        </div>
      </main>
      <aside
        data-region="calendar-pane"
        aria-label={t.reports.history}
        className="order-1 shrink-0 border-b border-border bg-surface px-4 py-3 lg:order-2 lg:h-full lg:w-[17.5rem] lg:border-b-0 lg:border-l lg:px-3 lg:py-5"
      >
        <ReportsCalendar
          type={liveType}
          selectedStart={report?.periodStart}
          weekStartsOn={weekStartsOn}
          timeZone={timeZone}
          onPick={(ymd) => void openPeriod(liveType, ymd)}
        />
      </aside>
    </div>
  );
}
