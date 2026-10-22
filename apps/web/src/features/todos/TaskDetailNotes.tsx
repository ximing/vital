import { lazy, Suspense } from 'react';
import { t } from '@/copy';
import { loadNotesEditor } from '@/shell/route-loaders';

const NotesEditor = lazy(() => loadNotesEditor().then((m) => ({ default: m.NotesEditor })));

export function TaskDetailNotes({
  notes,
  onChange,
}: {
  notes: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="mt-7">
      <p className="eyebrow eyebrow-rule mb-2.5">{t.todos.notes}</p>
      <Suspense
        fallback={
          <div
            className="skeleton-pulse min-h-[8rem] rounded-md"
            aria-busy="true"
            aria-label={t.todos.loading}
          />
        }
      >
        <NotesEditor value={notes} onChange={onChange} />
      </Suspense>
    </div>
  );
}
