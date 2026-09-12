import type { NowRecommendation, Outcome, TodayNow } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { useState, type FC } from 'react';
import { t } from '@/copy';
import { TodosUiService } from '@/features/todos/todos-ui.service';

/**
 * "当下" card: left — current time, continuous free time and the rule reason;
 * right — 1–2 rule-based picks. Recommendations are candidates, not a
 * sequence; 换一个 rotates them locally.
 */
export const NowCard: FC<{
  now: TodayNow;
  outcomes: Outcome[];
  timeZone: string;
}> = observer(function NowCard({
  now,
  outcomes,
  timeZone,
}: {
  now: TodayNow;
  outcomes: Outcome[];
  timeZone: string;
}) {
  const todos = useService(TodosUiService);
  const [offset, setOffset] = useState(0);

  const recs = now.recommendations;
  // 换一个: local rotation of the candidate list.
  const start = recs.length > 1 ? offset % recs.length : 0;
  const shown = recs.length > 1 ? [...recs.slice(start), ...recs.slice(0, start)] : recs;

  const timeLabel = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date());

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

  return (
    <section
      data-region="now-card"
      aria-label={t.today.now.title}
      className="mt-4 flex flex-col gap-4 rounded-[18px] border border-border border-l-[3px] border-l-accent bg-surface px-6 py-5 shadow-[var(--shadow-xs)] sm:flex-row sm:gap-6"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-tertiary">
          {t.today.now.title}
        </p>
        <p className="mt-0.5 font-display text-[34px] font-bold leading-10 tabular-nums">
          {timeLabel}
        </p>
        <p className="mt-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {now.quiet
            ? t.today.now.quietLabel
            : t.today.now.next.replace('{m}', String(now.continuousMinutes))}
        </p>
        <p className="mt-2.5 text-[length:var(--text-meta)] leading-[19px] text-muted">
          {now.reason}
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-tertiary">
            {t.today.now.suggestTitle}
          </span>
          <button
            type="button"
            disabled={recs.length < 2}
            onClick={() => setOffset((value) => value + 1)}
            className="inline-flex h-6 shrink-0 items-center rounded-full border border-border px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            {t.today.now.swap}
          </button>
        </div>

        {shown.map((rec) => (
          <button
            key={rec.taskId}
            type="button"
            data-region="now-recommendation"
            onClick={() => todos.openDetail(rec.taskId)}
            className="flex flex-col gap-0.5 rounded-xl border border-border bg-elevated px-3.5 py-2.5 text-left transition-[border-color,box-shadow] duration-[var(--ease-out)] hover:border-accent hover:shadow-[var(--shadow-xs)]"
          >
            <span className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] font-semibold text-fg">
              {rec.title}
            </span>
            <span className="flex flex-wrap gap-x-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
              <span>{meta(rec)}</span>
              {rec.dueSoon ? <span className="font-semibold text-due">{t.today.now.dueSoon}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
});
