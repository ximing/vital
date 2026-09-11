import type { ReportCarriedTask, ReportReview, ReportReviewTask, ReviewHabitProgress } from '@vital/dto';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';
import { PriorityMark } from '@/features/todos/priority';

/** Semantic hue for the captured rows' mini dot — matches the meta-row stats coding. */
const CAPTURED_TONE = 'var(--status-doing)';

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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const empty =
    review.completed.length === 0 && review.carried.length === 0 && review.captured.length === 0 && (review.habitProgress?.length ?? 0) === 0;

  function toggleSection(key: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (empty) {
    return (
      <p className="px-2 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
        {t.reports.emptyDone}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {review.completed.length > 0 ? (
        <Section
          id="completed"
          title={t.reports.completed}
          count={review.completed.length}
          collapsed={collapsed}
          onToggle={toggleSection}
        >
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
      {(review.habitProgress?.length ?? 0) > 0 ? (
        <Section
          id="habit-progress"
          title={t.reports.habitProgress}
          count={review.habitProgress.length}
          collapsed={collapsed}
          onToggle={toggleSection}
        >
          {review.habitProgress.map((item) => (
            <HabitProgressRow key={item.habitId} item={item} />
          ))}
        </Section>
      ) : null}
      {review.carried.length > 0 ? (
        <Section
          id="carried"
          title={t.reports.carried}
          count={review.carried.length}
          collapsed={collapsed}
          onToggle={toggleSection}
        >
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
        <Section
          id="captured"
          title={t.reports.captured}
          count={review.captured.length}
          collapsed={collapsed}
          onToggle={toggleSection}
        >
          {review.captured.map((item) => (
            <button
              key={item.inboxId}
              type="button"
              className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[length:var(--text-body)] text-fg hover:bg-surface-muted"
              onClick={() => onOpenInbox(item.inboxId)}
            >
              <span
                className="h-1 w-1 shrink-0 rounded-full"
                style={{ background: CAPTURED_TONE }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
            </button>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

/** Eyebrow-rule group header — same collapse pattern as the todos ListView. */
function Section({
  id,
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count: number;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  const isCollapsed = collapsed.has(id);
  return (
    <section>
      <button
        type="button"
        aria-expanded={!isCollapsed}
        onClick={() => onToggle(id)}
        className="eyebrow eyebrow-rule rounded px-2 text-left"
      >
        <Icon
          icon={isCollapsed ? ChevronRight : ChevronDown}
          size={12}
          className="shrink-0 opacity-70"
        />
        <span className="truncate">{title}</span>
        <span className="shrink-0 font-mono font-normal normal-case tracking-normal tabular-nums opacity-80">
          {count}
        </span>
      </button>
      {isCollapsed ? null : <div className="mt-1 flex flex-col">{children}</div>}
    </section>
  );
}

function HabitProgressRow({ item }: { item: ReviewHabitProgress }) {
  return (
    <div className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 hover:bg-surface-muted">
      <HabitRing done={item.done} target={item.target} />
      <span className="min-w-0 flex-1 truncate text-left text-[length:var(--text-body)] text-fg">
        {item.title}
      </span>
      {item.target !== null ? (
        <span className="shrink-0 whitespace-nowrap rounded-full bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-tertiary">
          {item.done}/{item.target}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Progress ring in the task-checkbox footprint (20px): a neutral track with a
 * done-hue arc; once the target is met it collapses into the same filled
 * check circle as a completed task. Target-less habits are binary — any
 * progress counts as done.
 */
function HabitRing({ done, target }: { done: number; target: number | null }) {
  const progress = target !== null && target > 0 ? Math.min(done / target, 1) : done > 0 ? 1 : 0;
  if (progress >= 1) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-done">
        <Check size={11} strokeWidth={3.2} className="text-on-accent" aria-hidden />
      </span>
    );
  }
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 -rotate-90" aria-hidden>
      <circle cx="10" cy="10" r={radius} fill="none" stroke="var(--border-subtle)" strokeWidth="1.5" />
      {progress > 0 ? (
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke="var(--status-done)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      ) : null}
    </svg>
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
    <div className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 hover:bg-surface-muted">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={t.reports.complete}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
          done ? 'border-done bg-done' : 'border-due/70'
        }`}
        onClick={onToggle}
      >
        {done ? <Check size={11} strokeWidth={3.2} className="text-on-accent" aria-hidden /> : null}
      </button>
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
    <div className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 hover:bg-surface-muted">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={t.reports.complete}
        disabled={item.deleted}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
          done ? 'border-done bg-done' : 'border-due/70'
        } disabled:opacity-40`}
        onClick={onToggle}
      >
        {done ? <Check size={11} strokeWidth={3.2} className="text-on-accent" aria-hidden /> : null}
      </button>
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
