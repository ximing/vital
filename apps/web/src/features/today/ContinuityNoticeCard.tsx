import type { ContinuityFeedbackKind, ContinuityIntervention } from '@vital/dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { invalidateContinuity, useContinuityInterventionsQuery } from './queries';
import { TodaySectionHead } from './SectionHead';

const copy = t.today.notice;

const PRIMARY_CLASS =
  'inline-flex h-8 items-center rounded-full bg-accent px-3.5 text-[length:var(--text-caption)] font-semibold text-on-accent transition-[color,background-color] duration-[var(--ease-out)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';

const SECONDARY_CLASS =
  'inline-flex h-8 items-center rounded-full px-3 text-[length:var(--text-caption)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60';

function durationLabel(minutes: number): string {
  return copy.duration.replace('{m}', String(minutes));
}

function ExpandedNotice({
  item,
  busy,
  error,
  onFeedback,
}: {
  item: ContinuityIntervention;
  busy: boolean;
  error: string | null;
  onFeedback: (kind: ContinuityFeedbackKind) => void;
}) {
  const action = item.content.primaryAction;
  const standard = action.completionStandard.trim();
  return (
    <article className="rounded-[18px] bg-surface px-5 py-4">
      {item.content.facts.length > 0 ? (
        <ul className="space-y-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg">
          {item.content.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
        {item.content.whyNow}
      </p>
      <p className="mt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg">
        {action.title.trim() || copy.start}
        <span className="ml-2 font-mono text-[length:var(--text-caption)] tabular-nums text-tertiary">
          {durationLabel(action.durationMin)}
        </span>
      </p>
      {standard !== '' ? (
        <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
          {standard}
        </p>
      ) : null}
      {error ? (
        <div className="mt-3">
          <Banner>{error}</Banner>
        </div>
      ) : null}
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <Link to={`/today/threads/${item.outcomeId}`} className={PRIMARY_CLASS}>
          {copy.start}
        </Link>
        <button type="button" className={SECONDARY_CLASS} disabled={busy} onClick={() => onFeedback('done')}>
          {copy.done}
        </button>
        <button type="button" className={SECONDARY_CLASS} disabled={busy} onClick={() => onFeedback('adjust')}>
          {copy.adjust}
        </button>
        <button type="button" className={SECONDARY_CLASS} disabled={busy} onClick={() => onFeedback('pause')}>
          {copy.pause}
        </button>
      </div>
    </article>
  );
}

/**
 * Today-page stall/risk notices. Hidden when the list is empty — no empty copy.
 * Default-expands the first of at most three; collapsed rows show whyNow only.
 */
export function ContinuityNoticeCard() {
  const qc = useQueryClient();
  const query = useContinuityInterventionsQuery();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Set<string>());

  const items = (query.data?.items ?? []).slice(0, 3);
  const expandedId =
    pickedId !== null && items.some((item) => item.id === pickedId) ? pickedId : (items[0]?.id ?? null);

  const feedback = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: ContinuityFeedbackKind; outcomeId: string }) =>
      client.feedbackContinuityIntervention(id, { kind }),
    onSuccess: (_data, vars) => {
      setError(null);
      invalidateContinuity(qc, vars.outcomeId);
    },
    onError: (err) => setError(humanError(err)),
  });

  useEffect(() => {
    if (!expandedId || seen.current.has(expandedId)) return;
    seen.current.add(expandedId);
    void client.markContinuityInterventionSeen(expandedId).catch(() => {
      seen.current.delete(expandedId);
    });
  }, [expandedId]);

  if (items.length === 0) return null;

  return (
    <section data-region="continuity-notice" aria-label={copy.title} className="mt-7">
      <TodaySectionHead title={copy.title} count={items.length} />
      <div className="flex flex-col gap-2">
        {items.map((item) =>
          item.id === expandedId ? (
            <ExpandedNotice
              key={item.id}
              item={item}
              busy={feedback.isPending}
              error={error}
              onFeedback={(kind) => {
                setError(null);
                feedback.mutate({ id: item.id, kind, outcomeId: item.outcomeId });
              }}
            />
          ) : (
            <button
              key={item.id}
              type="button"
              aria-expanded={false}
              aria-label={`${copy.expand}：${item.content.whyNow}`}
              onClick={() => {
                setError(null);
                setPickedId(item.id);
              }}
              className="min-h-9 w-full border-b border-border/60 px-1 py-2.5 text-left text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted transition-colors hover:text-fg"
            >
              <span className="line-clamp-1">{item.content.whyNow}</span>
            </button>
          ),
        )}
      </div>
    </section>
  );
}
