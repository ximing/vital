import type { Report, ReportType, SyncHead } from '@vital/dto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { useOnline } from '@/features/inbox/online';
import { markOnboarding } from '@/features/onboarding/mark';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { EmptyArt } from '@/ui/empty-art';
import {
  applyRemoteBody,
  decidePoll,
  isDirty,
  isRevisionConflict,
  parseReportType,
  POLL_MS,
  reportHref,
  REPORT_TYPES,
  SAVE_DEBOUNCE_MS,
} from './model';
import {
  useCurrentReportQuery,
  useReportActions,
  useReportListQuery,
  useReportQuery,
} from './queries';
import { SourceEditor } from './SourceEditor';
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
  sourceMode: boolean;
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
    sourceMode: prev?.sourceMode ?? false,
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

  const currentQuery = useCurrentReportQuery(typeParam, id === '');
  const reportQuery = useReportQuery(id, id !== '');
  const liveType: ReportType = reportQuery.data?.type ?? typeParam;
  const listQuery = useReportListQuery(liveType);

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
    if (id !== '') return;
    const current = currentQuery.data;
    if (current) navigate(reportHref(current.id, current.type), { replace: true });
  }, [id, currentQuery.data, navigate]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault();
        if (fillingRef.current) return;
        const live = sessionRef.current;
        if (!live) return;
        const next = { ...live, sourceMode: !live.sourceMode };
        sessionRef.current = next;
        setSession(next);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  async function switchType(next: ReportType): Promise<void> {
    cancelSaveTimer();
    try {
      if (saveInFlightRef.current) await saveInFlightRef.current;
      const live = sessionRef.current;
      if (live && live.id === id && sessionDirty(live) && !live.conflict && !live.blockSave) {
        await runSaveTracked(live);
      }
      const current = await actions.loadCurrent(next);
      navigate(reportHref(current.id, current.type));
    } catch (err) {
      if (isRevisionConflict(err)) {
        patchLive((s) => ({ ...s, conflict: true, blockSave: true }));
      } else {
        patchLive((s) => ({ ...s, saveError: humanError(err) }));
      }
    }
  }

  async function onFill(): Promise<void> {
    const live = sessionRef.current;
    if (
      !live ||
      live.id !== id ||
      live.conflict ||
      live.blockSave ||
      live.filling ||
      fillingRef.current
    ) {
      return;
    }
    fillingRef.current = true;
    cancelSaveTimer();
    commitSession({ ...live, filling: true, blockSave: true, saveError: null });
    try {
      if (saveInFlightRef.current) await saveInFlightRef.current;
      const after = sessionRef.current;
      if (!after || after.id !== id) return;
      let rev = after.revision;
      if (sessionDirty(after)) {
        const saved = await runSaveTracked(after);
        rev = saved.revision;
      }
      const filled = await actions.fill.mutateAsync({ id: after.id, revision: rev });
      fillingRef.current = false;
      commitSession(sessionFrom(filled, sessionRef.current));
      reportUi().setEmbeds(filled.embeds);
    } catch (err) {
      fillingRef.current = false;
      if (isRevisionConflict(err)) {
        patchLive((s) => ({
          ...s,
          filling: false,
          conflict: true,
          blockSave: true,
          saveState: 'idle',
        }));
      } else {
        patchLive((s) => ({
          ...s,
          filling: false,
          blockSave: false,
          saveError: humanError(err),
          saveState: 'idle',
        }));
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
    } catch (err) {
      patchLive((s) => ({ ...s, saveError: humanError(err) }));
    }
  }

  function handleHydrate(md: string): void {
    patchLive((s) => {
      const wasDirty = sessionDirty(s);
      return { ...s, draftMd: md, serverMd: wasDirty ? s.serverMd : md };
    });
  }

  const history = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const loading = id === '' ? currentQuery.isLoading : reportQuery.isLoading && session?.id !== id;
  const error = id === '' ? currentQuery.error : reportQuery.error;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="px-4 pb-2 pt-6">
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {t.reports.kicker}
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div
            className="flex rounded-md bg-surface p-0.5"
            role="tablist"
            aria-label={t.nav.reports}
          >
            {REPORT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={liveType === type}
                className={`min-h-[var(--touch-min)] rounded-md px-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] ${
                  liveType === type ? 'bg-accent-subtle text-fg' : 'text-muted hover:text-fg'
                }`}
                onClick={() => void switchType(type)}
              >
                {t.reports[type]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              disabled={
                !online ||
                !session ||
                session.conflict ||
                session.blockSave ||
                session.filling ||
                session.saveState === 'saving' ||
                actions.fill.isPending
              }
              loading={actions.fill.isPending || session?.filling === true}
              onClick={() => void onFill()}
            >
              {actions.fill.isPending ? t.reports.filling : t.reports.fill}
            </Button>
            <Button
              variant="quiet"
              aria-pressed={session?.sourceMode === true}
              aria-label={t.reports.sourceToggle}
              disabled={session?.filling === true}
              onClick={() => patchLive((s) => ({ ...s, sourceMode: !s.sourceMode }))}
            >
              {session?.sourceMode ? t.reports.wysiwyg : t.reports.source}
            </Button>
            <span className="text-[length:var(--text-caption)] text-muted" role="status">
              {session?.saveState === 'saving'
                ? t.reports.saving
                : session?.saveState === 'saved' && !dirty
                  ? t.reports.saved
                  : null}
            </span>
          </div>
        </div>
      </header>

      {!online ? (
        <div className="px-4">
          <Banner>{t.todos.offline}</Banner>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-3 px-4 py-2">
          <Banner>{humanError(error)}</Banner>
          <Button
            variant="ghost"
            onClick={() => {
              void currentQuery.refetch();
              void reportQuery.refetch();
            }}
          >
            {t.reports.retry}
          </Button>
        </div>
      ) : null}

      {session?.saveError ? (
        <div className="px-4 py-2">
          <Banner>{session.saveError}</Banner>
        </div>
      ) : null}

      {session?.conflict ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2">
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
        <div className="flex flex-wrap items-center gap-3 px-4 py-2" role="status">
          <p className="text-[length:var(--text-meta)] text-muted">{t.reports.remoteUpdated}</p>
          <Button variant="ghost" onClick={() => void reloadRemote()}>
            {t.reports.reload}
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div
          className="mx-auto w-full max-w-[65ch] px-4 py-10"
          aria-busy="true"
          aria-label={t.reports.loading}
        >
          <div className="skeleton-pulse mb-4 h-10 rounded-md" />
          <div className="skeleton-pulse h-64 rounded-md" />
        </div>
      ) : id === '' || !session || session.id !== id ? (
        <EmptyReports onOpen={() => void switchType(typeParam)} />
      ) : (
        <div className="mx-auto flex w-full max-w-[65ch] flex-1 flex-col px-4 pb-16 pt-6">
          <input
            aria-label={t.reports.title}
            value={session.draftTitle}
            disabled={!online || session.filling}
            onChange={(event) => patchLive((s) => ({ ...s, draftTitle: event.target.value }))}
            className="mb-6 w-full bg-transparent text-[length:var(--text-display)] font-semibold leading-[var(--text-display-lh)] tracking-[-0.03em] text-fg outline-none"
          />
          {session.sourceMode ? (
            <SourceEditor
              value={session.draftMd}
              editable={online && !session.filling}
              onChange={(md) => patchLive((s) => ({ ...s, draftMd: md }))}
            />
          ) : (
            <WysiwygEditor
              key={`${session.id}:${session.editorKey}`}
              bodyMd={session.draftMd}
              editable={online && !session.filling}
              onChange={(md) => patchLive((s) => ({ ...s, draftMd: md }))}
              onHydrate={handleHydrate}
              onToggleTask={(taskId) => void toggleTask(taskId)}
            />
          )}
        </div>
      )}

      {history.length > 0 ? (
        <aside className="border-t border-border px-4 py-6">
          <p className="mb-2 text-[length:var(--text-caption)] text-muted">{t.reports.history}</p>
          <ul className="flex flex-col gap-1">
            {history.map((item) => (
              <li key={item.id}>
                <NavLink
                  to={reportHref(item.id, item.type)}
                  className={({ isActive }) =>
                    `flex min-h-[var(--touch-min)] items-center rounded-md px-3 text-[length:var(--text-meta)] ${
                      isActive
                        ? 'bg-accent-subtle text-fg'
                        : 'text-muted hover:bg-surface-muted hover:text-fg'
                    }`
                  }
                >
                  {item.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}

function EmptyReports({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex flex-col items-start px-4 py-16">
      <EmptyArt />
      <p className="max-w-md text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
        {t.empty.reports}
      </p>
      <button
        type="button"
        className="mt-5 inline-flex min-h-[var(--touch-min)] items-center rounded-md bg-accent-subtle px-4 text-fg transition-[background-color] duration-[var(--ease-out)] hover:bg-surface-muted"
        onClick={onOpen}
      >
        {t.empty.actionDaily}
      </button>
    </div>
  );
}
