import type { List, TaskPriority } from '@vital/dto';
import { CircleArrowUp, Folder } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { usePopover } from '@/ui/use-popover';
import { QUICK_ADD_ID } from './keyboard';
import { inboxList, userLists } from './model';
import { PriorityMenu } from './priority';
import { emptyScheduleDraft, type ScheduleDraft } from './schedule-draft';
import { SchedulePopover } from './SchedulePopover';
import { useTodosUi } from './todos-ui.service';

export type ComposeExtras = {
  listId: string;
  priority?: TaskPriority;
  status?: 'todo' | 'doing';
};

export function QuickAdd({
  onSubmit,
  disabled,
  hint,
  listName,
  lists,
  defaultListId,
  zone,
  weekStartsOn,
  variant = 'bar',
  captureId = true,
  lockedPriority,
  lockedStatus,
  intent = false,
}: {
  onSubmit: (title: string, draft: ScheduleDraft, extras: ComposeExtras) => Promise<void> | void;
  disabled?: boolean;
  hint?: string;
  listName: string;
  lists: List[];
  defaultListId: string;
  zone: string;
  weekStartsOn: 0 | 1;
  variant?: 'bar' | 'card';
  captureId?: boolean;
  lockedPriority?: TaskPriority;
  lockedStatus?: 'todo' | 'doing';
  intent?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nonce = useTodosUi((s) => s.quickAddNonce);
  const [draft, setDraft] = useState<ScheduleDraft>(emptyScheduleDraft);
  const [priority, setPriority] = useState<TaskPriority>(lockedPriority ?? 3);
  const [listId, setListId] = useState(defaultListId);
  const [prevDefaultListId, setPrevDefaultListId] = useState(defaultListId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow defaultListId changes by adjusting state during render.
  if (defaultListId !== prevDefaultListId) {
    setPrevDefaultListId(defaultListId);
    setListId(defaultListId);
  }

  useEffect(() => {
    if (captureId && nonce > 0) inputRef.current?.focus();
  }, [captureId, nonce]);

  async function handle(event: FormEvent) {
    event.preventDefault();
    const el = inputRef.current;
    if (!el || disabled || busy) return;
    const title = el.value.trim();
    if (title === '') return;
    const next = draft;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(title, next, {
        listId,
        priority: intent ? lockedPriority : priority,
        status: lockedStatus,
      });
      el.value = '';
      setDraft(emptyScheduleDraft());
      setPriority(lockedPriority ?? 3);
      setListId(defaultListId);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  const card = variant === 'card';
  const placeholder =
    hint ??
    (intent
      ? t.todos.composeIntent
      : card
        ? t.todos.composeWhat
        : `${t.todos.composeTo} “${listName}”`);
  const tools = (
    <>
      {intent ? null : (
        <SchedulePopover
          draft={draft}
          zone={zone}
          weekStartsOn={weekStartsOn}
          onChange={setDraft}
          compact
          align="end"
          triggerClassName="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
          ariaLabel={t.todos.addDate}
        />
      )}
      {intent || lockedPriority !== undefined ? null : (
        <PriorityMenu value={priority} onChange={setPriority} align="end" />
      )}
      <ListMenu lists={lists} value={listId} onChange={setListId} />
    </>
  );

  const blocked = disabled || busy;
  const errorNode = error ? (
    <p className="px-1 pt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-danger">
      {error}
    </p>
  ) : null;

  if (card) {
    return (
      <form onSubmit={(event) => void handle(event)} className="pb-2">
        <div className="rounded-xl bg-elevated px-3 py-2 shadow-[0_0_0_1px_var(--border-subtle)]">
          <input
            id={captureId ? QUICK_ADD_ID : undefined}
            ref={inputRef}
            type="text"
            name="title"
            maxLength={intent ? 2000 : 500}
            disabled={blocked}
            placeholder={busy && intent ? t.todos.interpreting : placeholder}
            aria-label={t.todos.quickAddPlaceholder}
            aria-busy={busy || undefined}
            className="field-focus h-8 w-full border-0 bg-transparent px-0 text-[length:var(--text-body)] text-fg shadow-none placeholder:text-muted outline-none"
          />
          <div className="mt-1 flex items-center gap-0.5">
            {tools}
            <button
              type="submit"
              disabled={blocked}
              aria-label={t.todos.add}
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              <Icon icon={CircleArrowUp} size={16} />
            </button>
          </div>
        </div>
        {errorNode}
      </form>
    );
  }

  return (
    <form onSubmit={(event) => void handle(event)} className="w-full min-w-0 self-stretch pb-4 pt-1">
      <div className="flex h-[46px] w-full min-w-0 items-center gap-2 rounded-[14px] border border-border bg-surface px-4 shadow-[var(--shadow-xs)]">
        <span aria-hidden className="shrink-0 text-[17px] font-medium leading-none text-accent">+</span>
        <input
          id={captureId ? QUICK_ADD_ID : undefined}
          ref={inputRef}
          type="text"
          name="title"
          maxLength={intent ? 2000 : 500}
          disabled={blocked}
          placeholder={busy && intent ? t.todos.interpreting : placeholder}
          aria-label={t.todos.quickAddPlaceholder}
          aria-busy={busy || undefined}
          className="field-focus h-8 min-w-0 flex-1 border-0 bg-transparent px-0.5 text-[length:var(--text-body)] text-fg shadow-none placeholder:text-muted outline-none"
        />
        <div className="ml-auto flex shrink-0 items-center gap-1 text-muted">{tools}</div>
        <button type="submit" disabled={blocked} className="sr-only">
          {t.todos.add}
        </button>
      </div>
      {errorNode}
    </form>
  );
}

function ListMenu({
  lists,
  value,
  onChange,
}: {
  lists: List[];
  value: string;
  onChange: (id: string) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popover = usePopover(popoverRef);
  const inbox = inboxList(lists);
  const options = [
    ...(inbox ? [{ id: inbox.id, name: t.lists.inbox }] : []),
    ...userLists(lists).map((list) => ({ id: list.id, name: list.name })),
  ];
  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        aria-label={t.todos.list}
        aria-expanded={popover.open}
        onClick={() => popover.toggle()}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
      >
        <Icon icon={Folder} size={15} />
      </button>
      {popover.open ? (
        <div
          role="menu"
          className={`absolute right-0 z-[var(--z-dropdown)] mt-1 max-h-56 w-44 overflow-y-auto ${FIELD_POPOVER_CLASS} p-1`}
        >
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] hover:bg-surface-muted ${
                item.id === value ? 'text-fg' : 'text-muted'
              }`}
              onClick={() => {
                onChange(item.id);
                popover.close();
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
