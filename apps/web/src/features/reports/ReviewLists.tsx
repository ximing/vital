import type { ReportCarriedTask, ReportReview, ReportReviewTask } from '@vital/dto';
import { t } from '@/copy';
import { PriorityMark } from '@/features/todos/priority';

/** Semantic hue per review category — one coding system used by stats and section headers. */
const TONE = {
  completed: 'var(--status-done)',
  carried: 'var(--status-due-soon)',
  captured: 'var(--status-doing)',
} as const;

/** Toggle payload shared by completed and carried rows. */
export type ReviewToggleTask = { taskId: string; completionId: string | null };

export function ReviewLists({
  review,
  onToggleTask,
  onOpenTask,
  onOpenInbox,
  formatCompletedAt,
}: {
  review: ReportReview;
  onToggleTask: (task: ReviewToggleTask) => void;
  onOpenTask: (taskId: string) => void;
  onOpenInbox: (inboxId: string) => void;
  /** Renders a completion instant in the user's timezone, e.g. "9月7日". */
  formatCompletedAt: (iso: string) => string;
}) {
  const empty =
    review.completed.length === 0 && review.carried.length === 0 && review.captured.length === 0;

  return (
    <div className="rounded-[18px] border border-border bg-elevated px-5 py-4 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
        <Stat label={t.reports.completed} value={review.completed.length} tone={TONE.completed} />
        <Stat label={t.reports.carried} value={review.carried.length} tone={TONE.carried} />
        <Stat label={t.reports.captured} value={review.captured.length} tone={TONE.captured} />
      </div>
      {empty ? (
        <p className="mt-3 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
          {t.reports.emptyDone}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5 border-t border-border/60 pt-4">
          {review.completed.length > 0 ? (
            <Section title={t.reports.completed} tone={TONE.completed} count={review.completed.length}>
              {review.completed.map((item) => (
                <ReviewTaskRow
                  key={`${item.taskId}-${item.completionId ?? ''}`}
                  item={item}
                  done
                  onToggle={() => onToggleTask(item)}
                  onOpen={() => onOpenTask(item.taskId)}
                />
              ))}
            </Section>
          ) : null}
          {review.carried.length > 0 ? (
            <Section title={t.reports.carried} tone={TONE.carried} count={review.carried.length}>
              {review.carried.map((item) => (
                <CarriedTaskRow
                  key={item.taskId}
                  item={item}
                  onToggle={() => onToggleTask(item)}
                  onOpen={() => onOpenTask(item.taskId)}
                  formatCompletedAt={formatCompletedAt}
                />
              ))}
            </Section>
          ) : null}
          {review.captured.length > 0 ? (
            <Section title={t.reports.captured} tone={TONE.captured} count={review.captured.length}>
              {review.captured.map((item) => (
                <button
                  key={item.inboxId}
                  type="button"
                  className="flex min-h-9 w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[length:var(--text-body)] text-fg hover:bg-surface-muted"
                  onClick={() => onOpenInbox(item.inboxId)}
                >
                  <span
                    className="h-1 w-1 shrink-0 rounded-full"
                    style={{ background: TONE.captured }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                </button>
              ))}
            </Section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span
        className="h-1.5 w-1.5 shrink-0 self-center rounded-full"
        style={{ background: tone }}
        aria-hidden
      />
      <span className="font-display text-[length:var(--text-title)] font-semibold leading-none tabular-nums text-fg">
        {value}
      </span>
      <span className="text-[length:var(--text-caption)] text-muted">{label}</span>
    </span>
  );
}

function Section({
  title,
  tone,
  count,
  children,
}: {
  title: string;
  tone: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="eyebrow mb-1.5 flex items-center gap-2 px-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} aria-hidden />
        {title}
        <span className="font-mono normal-case tracking-normal tabular-nums opacity-70">{count}</span>
      </h2>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function ReviewTaskRow({
  item,
  done,
  onToggle,
  onOpen,
}: {
  item: ReportReviewTask;
  done: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex min-h-9 items-center gap-2.5 rounded-xl px-2 hover:bg-surface-muted">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={t.reports.complete}
        className={`h-5 w-5 shrink-0 rounded-full border-[1.5px] ${
          done ? 'border-done bg-done' : 'border-due/70'
        }`}
        onClick={onToggle}
      />
      <button
        type="button"
        className={`min-w-0 flex-1 truncate text-left text-[length:var(--text-body)] ${
          done ? 'text-muted line-through' : 'font-medium text-fg'
        }`}
        onClick={onOpen}
      >
        <PriorityMark priority={item.priority} className="mr-1.5 align-middle" />
        {item.title}
      </button>
    </div>
  );
}

/**
 * Frozen carried task: stays in the list forever. A task completed after the
 * freeze is annotated with when; a deleted one keeps its place, marked.
 */
function CarriedTaskRow({
  item,
  onToggle,
  onOpen,
  formatCompletedAt,
}: {
  item: ReportCarriedTask;
  onToggle: () => void;
  onOpen: () => void;
  formatCompletedAt: (iso: string) => string;
}) {
  const done = item.status === 'done' && !item.deleted;
  const annotation =
    done && item.completedAt !== null
      ? `${t.reports.finishedLater} · ${formatCompletedAt(item.completedAt)}`
      : null;
  return (
    <div className="flex min-h-9 items-center gap-2.5 rounded-xl px-2 hover:bg-surface-muted">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={t.reports.complete}
        disabled={item.deleted}
        className={`h-5 w-5 shrink-0 rounded-full border-[1.5px] ${
          done ? 'border-done bg-done' : 'border-due/70'
        } disabled:opacity-40`}
        onClick={onToggle}
      />
      <button
        type="button"
        className={`min-w-0 flex-1 truncate text-left text-[length:var(--text-body)] ${
          done || item.deleted ? 'text-muted line-through' : 'text-fg'
        }`}
        onClick={onOpen}
      >
        <PriorityMark priority={item.priority} className="mr-1.5 align-middle" />
        {item.title}
      </button>
      {item.deleted ? (
        <span className="shrink-0 text-[length:var(--text-caption)] text-tertiary">
          {t.reports.deleted}
        </span>
      ) : null}
      {annotation ? (
        <span className="shrink-0 text-[length:var(--text-caption)] text-tertiary">
          {annotation}
        </span>
      ) : null}
    </div>
  );
}
