import {
  noteRepeatsTasks,
  planSignalCounts,
  type NowRecommendation,
  type Outcome,
  type TodayModuleId,
  type TodayNow,
  type TodayPlan,
  type TodayPlanMark,
} from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { useState, type FC, type FormEvent } from 'react';
import { t } from '@/copy';
import { TodosUiService } from '@/features/todos';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { canOpenCalendarSettings, openCalendarSettings, type TodayBriefingModel } from './briefing';

/**
 * Today briefing plus the rule-based picks. The lead counts overdue and
 * priority, then names only those tasks. 换一个 rotates the candidate list locally.
 */
export const NowCard: FC<{
  now: TodayNow;
  outcomes: Outcome[];
  timeZone: string;
  briefing: TodayBriefingModel;
}> = observer(function NowCard({
  now,
  outcomes,
  briefing,
}: {
  now: TodayNow;
  outcomes: Outcome[];
  timeZone: string;
  briefing: TodayBriefingModel;
}) {
  const todos = useService(TodosUiService);
  const [offset, setOffset] = useState(0);
  const [placeDraft, setPlaceDraft] = useState('');
  const [editingPlace, setEditingPlace] = useState(false);

  const recs = now.recommendations;
  // 换一个: local rotation of the candidate list.
  const start = recs.length > 1 ? offset % recs.length : 0;
  const shown = recs.length > 1 ? [...recs.slice(start), ...recs.slice(0, start)] : recs;

  function outcomeName(id: string | null): string | null {
    if (id === null) return null;
    return outcomes.find((outcome) => outcome.id === id)?.name ?? null;
  }

  function meta(rec: NowRecommendation): string {
    const parts = [
      outcomeName(rec.outcomeId),
      rec.estimateMinutes === null
        ? t.today.now.noEstimate
        : t.today.now.estimate.replace('{m}', String(rec.estimateMinutes)),
    ].filter((part): part is string => part !== null);
    return parts.join('　');
  }

  function onPlace(event: FormEvent) {
    event.preventDefault();
    briefing.submitPlace(placeDraft);
    setPlaceDraft('');
    setEditingPlace(false);
  }

  return (
    <section
      data-region="now-card"
      aria-label={t.today.now.title}
      className="mt-4 rounded-[18px] border border-border border-l-[3px] border-l-accent bg-surface px-6 py-5 shadow-[var(--shadow-xs)]"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-tertiary">
        {t.today.now.title}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {briefing.modules.filter((module) => module.id !== 'note' || !noteRepeatsTasks(module.text ?? '', briefing.lead.titles)).map((module) => {
          const wide = module.id === 'lead' || module.id === 'note' || module.id === 'focus';
          return (
            <article
              key={module.id}
              data-region="today-module"
              data-module={module.id}
              className={`min-w-0 rounded-xl border border-border bg-canvas/50 px-3.5 py-3 ${wide ? 'sm:col-span-2' : ''}`}
            >
              <ModuleView
                moduleId={module.id}
                note={module.text}
                briefing={briefing}
                shown={shown}
                meta={meta}
                onOpen={(taskId) => todos.openDetail(taskId)}
                onSwap={() => setOffset((value) => value + 1)}
                recs={recs.length}
                placeDraft={placeDraft}
                editingPlace={editingPlace}
                onEditPlace={() => setEditingPlace(true)}
                onPlaceDraft={setPlaceDraft}
                onPlace={onPlace}
              />
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {now.quiet
          ? t.today.now.quietLabel
          : t.today.now.next.replace('{m}', String(now.continuousMinutes))}
      </p>
      <p className="mt-1.5 text-[length:var(--text-meta)] leading-[19px] text-muted">{now.reason}</p>
    </section>
  );
});

function moduleLabel(id: TodayModuleId): string {
  if (id === 'focus') return t.today.now.suggestTitle;
  return t.today.briefing.module[id];
}

const PLAN_MARK_CLASS: Record<TodayPlanMark, string> = {
  overdue: 'text-overdue',
  urgent: 'text-overdue',
  high: 'text-due',
  medium: 'text-doing',
};

function LeadBrief({ plan }: { plan: TodayPlan }) {
  const open =
    plan.counts.overdue + plan.counts.urgent + plan.counts.high + plan.counts.medium + plan.counts.plain;
  if (open === 0) {
    return (
      <div data-region="today-lead" className="mt-1.5">
        <p className="text-[length:var(--text-body)] leading-6 text-fg">{t.today.briefing.empty}</p>
      </div>
    );
  }
  if (plan.items.length === 0) {
    return (
      <div data-region="today-lead" className="mt-1.5">
        <p className="text-[length:var(--text-body)] leading-6 text-fg">
          {t.today.briefing.planPlain.replace('{n}', String(plan.counts.plain))}
        </p>
      </div>
    );
  }
  const tally =
    plan.items.length > 1 || plan.rest > 0
      ? planSignalCounts(plan.counts)
          .map((part) => t.today.briefing.planCount[part.key].replace('{n}', String(part.n)))
          .join(' · ')
      : null;
  return (
    <div data-region="today-lead" className="mt-1.5 space-y-1">
      {tally ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">{tally}</p>
      ) : null}
      {plan.items.map((item) => (
        <p key={item.id} className="flex items-baseline gap-2 text-[length:var(--text-body)] leading-6 text-fg">
          <span className={`w-8 shrink-0 text-[11px] font-semibold ${PLAN_MARK_CLASS[item.mark]}`}>
            {t.today.briefing.planMark[item.mark]}
          </span>
          <span className="min-w-0 font-medium">{item.title}</span>
          {item.when ? <span className="shrink-0 text-muted">· {item.when}</span> : null}
        </p>
      ))}
      {plan.rest > 0 ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {t.today.briefing.planRest.replace('{n}', String(plan.rest))}
        </p>
      ) : null}
    </div>
  );
}

function ModuleView({
  moduleId,
  note,
  briefing,
  shown,
  meta,
  onOpen,
  onSwap,
  recs,
  placeDraft,
  editingPlace,
  onEditPlace,
  onPlaceDraft,
  onPlace,
}: {
  moduleId: TodayModuleId;
  note?: string;
  briefing: TodayBriefingModel;
  shown: NowRecommendation[];
  meta: (rec: NowRecommendation) => string;
  onOpen: (taskId: string) => void;
  onSwap: () => void;
  recs: number;
  placeDraft: string;
  editingPlace: boolean;
  onEditPlace: () => void;
  onPlaceDraft: (value: string) => void;
  onPlace: (event: FormEvent) => void;
}) {
  const weather = briefing.weather;
  const showPlaceForm = weather.status !== 'ready' || editingPlace;
  return (
    <>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[11px] font-semibold tracking-wide text-tertiary">
          {moduleLabel(moduleId)}
        </p>
        {moduleId === 'focus' ? (
          <button
            type="button"
            disabled={recs < 2}
            onClick={onSwap}
            className="inline-flex h-6 shrink-0 items-center rounded-full border border-border px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            {t.today.now.swap}
          </button>
        ) : null}
      </div>
      {moduleId === 'note' ? (
        <p className="mt-1.5 text-[length:var(--text-body)] font-medium leading-6 text-fg">{note}</p>
      ) : null}
      {moduleId === 'lead' ? <LeadBrief plan={briefing.lead} /> : null}
      {moduleId === 'weather' ? (
        <div className="mt-1.5 space-y-1.5 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)]">
          <div data-region="today-weather">
            {weather.status === 'loading' ? (
              <p className="text-muted">{t.today.briefing.weatherLoading}</p>
            ) : null}
            {weather.status === 'unavailable' ? <p>{t.today.briefing.weatherUnavailable}</p> : null}
            {weather.status === 'ready' ? (
              <p>
                {weather.place} · {weather.condition} {weather.temperatureC}°C
                {showPlaceForm ? null : (
                  <button
                    type="button"
                    onClick={onEditPlace}
                    className="ml-2 text-[length:var(--text-caption)] text-tertiary underline-offset-2 hover:underline"
                  >
                    {t.today.briefing.setPlace}
                  </button>
                )}
              </p>
            ) : null}
            {showPlaceForm ? (
              <form onSubmit={onPlace} className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  aria-label={t.today.briefing.setPlace}
                  value={placeDraft}
                  placeholder={t.today.briefing.placePlaceholder}
                  onChange={(event) => onPlaceDraft(event.target.value)}
                  className={`${FIELD_CONTROL_CLASS} w-44`}
                />
                <button
                  type="submit"
                  disabled={briefing.placeBusy}
                  className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[length:var(--text-caption)] font-medium text-fg hover:bg-surface-muted disabled:opacity-50"
                >
                  {t.today.briefing.setPlace}
                </button>
              </form>
            ) : null}
          </div>
          {weather.status === 'ready' ? <p data-region="today-clothing">{weather.clothing}</p> : null}
        </div>
      ) : null}
      {moduleId === 'meetings' ? (
        <div
          data-region="today-meetings"
          className="mt-1.5 space-y-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)]"
        >
          {briefing.meetings.status === 'mac-only' ? <p>{t.today.briefing.meetingsMacOnly}</p> : null}
          {briefing.meetings.status === 'denied' ? (
            <div className="space-y-1.5">
              <p>{t.today.briefing.meetingsDenied}</p>
              <p className="text-muted">{t.today.briefing.meetingsDeniedHint}</p>
              {canOpenCalendarSettings() ? (
                <button
                  type="button"
                  onClick={openCalendarSettings}
                  className="inline-flex h-7 items-center rounded-full border border-border px-2.5 text-[11px] font-medium text-fg transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted"
                >
                  {t.today.briefing.meetingsOpenSettings}
                </button>
              ) : null}
            </div>
          ) : null}
          {briefing.meetings.status === 'failed' ? <p>{t.today.briefing.meetingsFailed}</p> : null}
          {briefing.meetings.status === 'events' && briefing.meetings.events.length === 0 ? (
            <p>{t.today.briefing.meetingsEmpty}</p>
          ) : null}
          {briefing.meetings.status === 'events'
            ? briefing.meetings.events.map((event) => (
                <p key={`${event.title}-${event.start}`}>
                  {event.title} · {event.allDay ? t.today.briefing.allDay : event.start}
                </p>
              ))
            : null}
        </div>
      ) : null}
      {moduleId === 'upcoming' ? (
        <div
          data-region="today-upcoming"
          className="mt-1.5 space-y-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)]"
        >
          {briefing.upcoming.length === 0 ? <p>{t.today.briefing.upcomingEmpty}</p> : null}
          {briefing.upcoming.map((item) => (
            <p key={item.id}>
              {item.title} · {item.when}
            </p>
          ))}
        </div>
      ) : null}
      {moduleId === 'holiday' ? (
        <p
          data-region="today-holiday"
          className="mt-1.5 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] tabular-nums"
        >
          {briefing.holidayName} · {briefing.holidayDate}
        </p>
      ) : null}
      {moduleId === 'focus' ? (
        <div className="mt-2 flex flex-col gap-2">
          {shown.map((rec) => (
            <button
              key={rec.taskId}
              type="button"
              data-region="now-recommendation"
              onClick={() => onOpen(rec.taskId)}
              className="flex flex-col gap-0.5 rounded-xl border border-border bg-elevated px-3.5 py-2.5 text-left transition-[border-color,box-shadow] duration-[var(--ease-out)] hover:border-accent hover:shadow-[var(--shadow-xs)]"
            >
              <span className="text-[length:var(--text-meta)] font-semibold leading-[var(--text-meta-lh)] text-fg">
                {rec.title}
              </span>
              <span className="flex flex-wrap gap-x-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                <span>{meta(rec)}</span>
                {rec.dueSoon ? (
                  <span className="font-semibold text-due">{t.today.now.dueSoon}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
