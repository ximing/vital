import type { NowRecommendation, Outcome, TodayNow } from '@vital/dto';
import { useState } from 'react';
import { t } from '@/copy';
import { useTodosUi } from '@/features/todos/todos-ui.service';

/**
 * "当下" card: continuous free time plus 1–2 rule-based picks, right below the
 * pulse strip. Recommendations are candidates, not a sequence; 换一个 rotates
 * them locally.
 */
export function NowCard({
  now,
  outcomes,
  timeZone,
}: {
  now: TodayNow;
  outcomes: Outcome[];
  timeZone: string;
}) {
  const openDetail = useTodosUi((s) => s.openDetail);
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
      className="mt-4 rounded-xl border border-border border-l-2 border-l-accent bg-elevated px-5 py-4 shadow-[var(--shadow-xs)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="shrink-0 font-display text-[length:var(--text-section)] font-semibold leading-[var(--text-section-lh)]">
            {t.today.now.title}
          </span>
          <span className="font-display text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)]">
            {timeLabel}
          </span>
        </div>
        <button
          type="button"
          disabled={recs.length < 2}
          onClick={() => setOffset((value) => value + 1)}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[length:var(--text-meta)] text-muted transition-colors hover:bg-surface-muted hover:text-fg disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted"
        >
          {t.today.now.swap}
        </button>
      </div>

      <p className="mt-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {now.quiet
          ? t.today.now.quietLabel
          : t.today.now.next.replace('{m}', String(now.continuousMinutes))}
      </p>

      <p className="mt-2 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
        {now.reason}
      </p>

      {shown.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {shown.map((rec) => (
            <button
              key={rec.taskId}
              type="button"
              data-region="now-recommendation"
              onClick={() => openDetail(rec.taskId)}
              className="rounded-lg border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:bg-surface-muted"
            >
              <span className="block font-medium text-fg">{rec.title}</span>
              <span className="mt-1 block text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
                {meta(rec)}
                {rec.dueSoon ? (
                  <>
                    {'　'}
                    <span className="text-due">{t.today.now.dueSoon}</span>
                  </>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
