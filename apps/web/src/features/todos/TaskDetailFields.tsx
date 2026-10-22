import type { Outcome, PatchTaskInput, Tag, Task } from '@vital/dto';
import type { FormEvent, RefObject } from 'react';
import { t } from '@/copy';
import { OutcomeField } from '@/ui/outcome-field';
import { EstimateField } from './EstimateField';

export function TaskDetailFields({
  task,
  title,
  setTitle,
  titleRef,
  saveTitle,
  outcomes,
  runPatch,
  tags,
  toggleTag,
  tagDraft,
  setTagDraft,
  addTag,
}: {
  task: Task;
  title: string;
  setTitle: (next: string) => void;
  titleRef: RefObject<HTMLTextAreaElement | null>;
  saveTitle: () => void;
  outcomes: Outcome[];
  runPatch: (input: PatchTaskInput) => void;
  tags: Tag[];
  toggleTag: (id: string) => void;
  tagDraft: string;
  setTagDraft: (next: string) => void;
  addTag: (event: FormEvent) => Promise<void>;
}) {
  return (
    <>
      <textarea
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229)
            return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        }}
        onBlur={saveTitle}
        rows={1}
        className="font-display max-h-[calc(var(--text-title-lh)*3)] w-full resize-none overflow-y-auto break-words bg-transparent text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] text-fg outline-none"
        aria-label={t.todos.title}
      />

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <OutcomeField
          value={task.outcomeId}
          outcomes={outcomes}
          onChange={(outcomeId) => runPatch({ outcomeId })}
        />
        <EstimateField
          value={task.estimateMinutes}
          onChange={(estimateMinutes) => runPatch({ estimateMinutes })}
        />
        {tags
          .filter((tag) => task.tagIds.includes(tag.id))
          .map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="h-6 rounded-full bg-accent-subtle px-2.5 text-[length:var(--text-caption)] font-medium text-accent transition-opacity duration-[var(--ease-out)] hover:opacity-75"
              onClick={() => toggleTag(tag.id)}
            >
              #{tag.name}
            </button>
          ))}
        <form onSubmit={(e) => void addTag(e)}>
          <input
            className="h-6 w-28 rounded-full border border-dashed border-border bg-transparent px-2.5 text-[length:var(--text-caption)] text-fg outline-none transition-[background-color,border-color] duration-[var(--ease-out)] placeholder:text-muted hover:border-tertiary/50 focus:border-focus focus:bg-surface"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            placeholder={t.todos.addTag}
            aria-label={t.todos.addTag}
            maxLength={40}
          />
        </form>
      </div>

      {task.outcomeId ? (
        <div className="mt-4 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={task.isMilestone === true}
              aria-label={t.todos.milestone}
              data-testid="task-milestone"
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--ease-out)] ${
                task.isMilestone === true ? 'bg-accent' : 'bg-surface-muted'
              }`}
              onClick={() => runPatch({ isMilestone: task.isMilestone !== true })}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-elevated shadow transition-[left] duration-[var(--ease-out)] ${
                  task.isMilestone === true ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </button>
            <span className="text-[length:var(--text-meta)] text-fg">{t.todos.milestone}</span>
          </div>
          <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.todos.milestoneHint}
          </p>
        </div>
      ) : null}
    </>
  );
}
