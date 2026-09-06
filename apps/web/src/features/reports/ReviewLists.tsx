import type { ReportReview, ReportReviewTask } from '@vital/dto';
import { t } from '@/copy';
import { PriorityMark } from '@/features/todos/priority';

export function ReviewLists({
  review,
  onToggleTask,
  onOpenTask,
  onOpenInbox,
}: {
  review: ReportReview;
  onToggleTask: (task: ReportReviewTask) => void;
  onOpenTask: (taskId: string) => void;
  onOpenInbox: (inboxId: string) => void;
}) {
  const empty =
    review.completed.length === 0 && review.carried.length === 0 && review.captured.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <Pill label={t.reports.completed} value={review.completed.length} />
        <Pill label={t.reports.carried} value={review.carried.length} />
        <Pill label={t.reports.captured} value={review.captured.length} />
      </div>
      {empty ? (
        <p className="text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
          {t.reports.emptyDone}
        </p>
      ) : (
        <>
          {review.completed.length > 0 ? (
            <Section title={t.reports.completed}>
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
            <Section title={t.reports.carried}>
              {review.carried.map((item) => (
                <ReviewTaskRow
                  key={item.taskId}
                  item={item}
                  done={false}
                  onToggle={() => onToggleTask(item)}
                  onOpen={() => onOpenTask(item.taskId)}
                />
              ))}
            </Section>
          ) : null}
          {review.captured.length > 0 ? (
            <Section title={t.reports.captured}>
              {review.captured.map((item) => (
                <button
                  key={item.inboxId}
                  type="button"
                  className="flex min-h-9 w-full items-center rounded-xl px-2 py-1.5 text-left text-[length:var(--text-body)] text-fg hover:bg-surface-muted"
                  onClick={() => onOpenInbox(item.inboxId)}
                >
                  {item.title}
                </button>
              ))}
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex items-baseline gap-1.5 text-[length:var(--text-caption)] text-muted"
    >
      <span className="font-semibold tabular-nums text-fg">{value}</span>
      <span>{label}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-[length:var(--text-caption)] text-muted">{title}</h2>
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
    <div className="flex min-h-9 items-center gap-2 rounded-xl px-1 hover:bg-surface-muted">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={t.reports.complete}
        className={`h-5 w-5 shrink-0 rounded-full border ${
          done ? 'border-done bg-done' : 'border-border'
        }`}
        onClick={onToggle}
      />
      <button
        type="button"
        className={`min-w-0 flex-1 truncate text-left text-[length:var(--text-body)] ${
          done ? 'text-muted line-through' : 'text-fg'
        }`}
        onClick={onOpen}
      >
        <PriorityMark priority={item.priority} className="mr-1.5 align-middle" />
        {item.title}
      </button>
    </div>
  );
}
