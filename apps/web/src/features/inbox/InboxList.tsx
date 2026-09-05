import type { InboxItem, Task } from '@vital/dto';
import { t } from '@/copy';
import { EmptyInbox, InboxSkeleton } from './EmptyInbox';
import { PendingRow, SaveRow, UnprocessedRow } from './InboxRow';
import { type PendingSave } from './model';

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h2
      id={id}
      className="px-3 pb-1 pt-5 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
    >
      {children}
    </h2>
  );
}

export function InboxList({
  tasks,
  tasksLoading,
  items,
  itemsLoading,
  pending,
  timeZone,
  online,
  onOpenTask,
  onCompleteTask,
  onRetry,
}: {
  tasks: Task[];
  tasksLoading: boolean;
  items: InboxItem[];
  itemsLoading: boolean;
  pending: PendingSave[];
  timeZone: string;
  online: boolean;
  onOpenTask: (task: Task) => void;
  onCompleteTask: (task: Task) => void;
  onRetry: (save: PendingSave) => void;
}) {
  const savesEmpty = items.length === 0 && pending.length === 0 && !itemsLoading;

  return (
    <div className="pb-16">
      <section aria-labelledby="inbox-unprocessed">
        <SectionHeading id="inbox-unprocessed">{t.inbox.unprocessed}</SectionHeading>
        {tasksLoading ? (
          <InboxSkeleton />
        ) : (
          <div role="list" aria-labelledby="inbox-unprocessed">
            {tasks.map((task) => (
              <UnprocessedRow
                key={task.id}
                task={task}
                timeZone={timeZone}
                onOpen={() => onOpenTask(task)}
                onComplete={() => onCompleteTask(task)}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="inbox-saves">
        <SectionHeading id="inbox-saves">{t.inbox.saves}</SectionHeading>
        {itemsLoading ? (
          <InboxSkeleton />
        ) : savesEmpty ? (
          <EmptyInbox />
        ) : (
          <div role="list" aria-labelledby="inbox-saves">
            {pending.map((save) => (
              <PendingRow
                key={save.id}
                save={save}
                disabled={!online || save.phase === 'processing'}
                onRetry={() => onRetry(save)}
              />
            ))}
            {items.map((item) => (
              <SaveRow key={item.id} item={item} timeZone={timeZone} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
