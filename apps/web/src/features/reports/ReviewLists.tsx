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
  return (
    <div className="flex flex-col gap-6">
      <Section title={`${t.reports.completed} ${review.completed.length}`}>
        {review.completed.length === 0 ? (
          <p className="text-[length:var(--text-body)] text-muted">{t.reports.emptyDone}</p>
        ) : (
          review.completed.map((item) => (
            <ReviewTaskRow
              key={`${item.taskId}-${item.completionId ?? ''}`}
              item={item}
              done
              onToggle={() => onToggleTask(item)}
              onOpen={() => onOpenTask(item.taskId)}
            />
          ))
        )}
      </Section>
      <Section title={`${t.reports.carried} ${review.carried.length}`}>
        {review.carried.length === 0 ? (
          <p className="text-[length:var(--text-body)] text-muted">{t.reports.emptyCarried}</p>
        ) : (
          review.carried.map((item) => (
            <ReviewTaskRow
              key={item.taskId}
              item={item}
              done={false}
              onToggle={() => onToggleTask(item)}
              onOpen={() => onOpenTask(item.taskId)}
            />
          ))
        )}
      </Section>
      <Section title={`${t.reports.captured} ${review.captured.length}`}>
        {review.captured.length === 0 ? (
          <p className="text-[length:var(--text-body)] text-muted">{t.reports.emptyCaptured}</p>
        ) : (
          review.captured.map((item) => (
            <button
              key={item.inboxId}
              type="button"
              className="flex min-h-9 w-full items-center rounded-xl px-2 py-1.5 text-left text-[length:var(--text-body)] text-fg hover:bg-surface-muted"
              onClick={() => onOpenInbox(item.inboxId)}
            >
              {item.title}
            </button>
          ))
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[length:var(--text-caption)] text-muted">{title}</h2>
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
