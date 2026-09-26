import type { List, TaskPriority } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { CircleArrowUp, Folder, LoaderCircle, Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FC, type FormEvent } from 'react';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { usePopover } from '@/ui/use-popover';
import { QUICK_ADD_ID } from './keyboard';
import { inboxList, listPickerRows } from './model';
import { PriorityMenu } from './priority';
import { emptyScheduleDraft, type ScheduleDraft } from './schedule-draft';
import { SchedulePopover } from './SchedulePopover';
import { TodosUiService } from './todos-ui.service';

export type ComposeExtras = {
  listId: string;
  priority?: TaskPriority;
  status?: 'todo' | 'doing';
};

export const QuickAdd: FC<{
  onSubmit: (title: string, draft: ScheduleDraft, extras: ComposeExtras) => Promise<void> | void;
  disabled?: boolean;
  hint?: string;
  listName: string;
  lists: List[];
  defaultListId: string;
  zone: string;
  weekStartsOn: 0 | 1;
  variant?: 'bar' | 'card' | 'row';
  captureId?: boolean;
  lockedPriority?: TaskPriority;
  lockedStatus?: 'todo' | 'doing';
  intent?: boolean;
}> = observer(function QuickAdd({
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
  variant?: 'bar' | 'card' | 'row';
  captureId?: boolean;
  lockedPriority?: TaskPriority;
  lockedStatus?: 'todo' | 'doing';
  intent?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const statusId = useId();
  const nonce = useService(TodosUiService).quickAddNonce;
  const [draft, setDraft] = useState<ScheduleDraft>(emptyScheduleDraft);
  const [priority, setPriority] = useState<TaskPriority>(lockedPriority ?? 3);
  const [listId, setListId] = useState(defaultListId);
  const [prevDefaultListId, setPrevDefaultListId] = useState(defaultListId);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasText, setHasText] = useState(false);

  // Follow defaultListId changes by adjusting state during render.
  if (defaultListId !== prevDefaultListId) {
    setPrevDefaultListId(defaultListId);
    setListId(defaultListId);
  }

  useEffect(() => {
    if (captureId && nonce > 0) inputRef.current?.focus();
  }, [captureId, nonce]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => setWaiting(true), 8000);
    return () => window.clearTimeout(timer);
  }, [busy]);

  async function handle(event: FormEvent) {
    event.preventDefault();
    const el = inputRef.current;
    if (!el || disabled || submittingRef.current) return;
    const title = el.value.trim();
    if (title === '') return;
    const next = draft;
    submittingRef.current = true;
    setWaiting(false);
    setBusy(true);
    setError(null);
    try {
      await onSubmit(title, next, {
        listId,
        priority: intent ? lockedPriority : priority,
        status: lockedStatus,
      });
      el.value = '';
      setHasText(false);
      setDraft(emptyScheduleDraft());
      setPriority(lockedPriority ?? 3);
      setListId(defaultListId);
    } catch (err) {
      setError(humanError(err));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  const card = variant === 'card';
  const row = variant === 'row';
  const placeholder =
    hint ??
    (intent
      ? t.todos.composeIntent
      : row
        ? t.todos.quickAddPlaceholder
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
          placement={row ? 'top' : 'bottom'}
          triggerClassName="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
          ariaLabel={t.todos.addDate}
        />
      )}
      {intent || lockedPriority !== undefined ? null : (
        <PriorityMenu
          value={priority}
          onChange={setPriority}
          align="end"
          placement={row ? 'top' : 'bottom'}
        />
      )}
      <ListMenu
        lists={lists}
        value={listId}
        onChange={setListId}
        placement={row ? 'top' : 'bottom'}
      />
    </>
  );

  const blocked = disabled || busy;
  const progressNode = (
    <div id={statusId} role="status" aria-live="polite" aria-atomic="true">
      {busy ? (
        <p className="flex items-center gap-2 px-1 pt-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-accent">
          <Icon
            icon={LoaderCircle}
            size={14}
            className="shrink-0 animate-spin motion-reduce:animate-none"
          />
          <span>
            {waiting ? t.todos.creatingWait : intent ? t.todos.interpreting : t.todos.creating}
          </span>
        </p>
      ) : null}
    </div>
  );
  const errorNode = error ? (
    <p
      role="alert"
      className="px-1 pt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-danger"
    >
      {error}
    </p>
  ) : null;

  if (card) {
    return (
      <form onSubmit={(event) => void handle(event)} className="pb-2">
        <div className="rounded-xl bg-elevated px-3 py-2 shadow-[0_0_0_1px_var(--border-subtle)] transition-shadow duration-[var(--ease-out)] focus-within:shadow-[0_0_0_1px_var(--border-focus),0_0_0_4px_var(--focus-ring)]">
          <input
            id={captureId ? QUICK_ADD_ID : undefined}
            ref={inputRef}
            type="text"
            name="title"
            maxLength={intent ? 2000 : 500}
            disabled={blocked}
            placeholder={placeholder}
            aria-label={t.todos.quickAddPlaceholder}
            aria-busy={busy || undefined}
            aria-describedby={busy ? statusId : undefined}
            className="h-8 w-full border-0 bg-transparent px-0 text-[length:var(--text-body)] text-fg shadow-none placeholder:text-muted outline-none"
          />
          <div className="mt-1 flex items-center gap-0.5">
            <fieldset
              disabled={blocked}
              className="flex min-w-0 items-center gap-0.5 border-0 p-0 disabled:opacity-50"
            >
              {tools}
            </fieldset>
            <button
              type="submit"
              disabled={blocked}
              aria-label={t.todos.add}
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              <Icon
                icon={busy ? LoaderCircle : CircleArrowUp}
                size={16}
                className={busy ? 'animate-spin motion-reduce:animate-none' : ''}
              />
            </button>
          </div>
        </div>
        {progressNode}
        {errorNode}
      </form>
    );
  }

  // Today keeps the composer as the next list line: same inset as a task
  // row, checkbox-sized mark, and no second bordered field inside the card.
  if (row) {
    return (
      <form
        onSubmit={(event) => void handle(event)}
        data-region="today-compose"
        className="group/compose mt-1 border-t border-border pb-1"
      >
        <div className="field-shell flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2">
          <span
            aria-hidden
            className="flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-full border-[1.5px] border-tertiary text-accent"
          >
            {busy ? (
              <Icon
                icon={LoaderCircle}
                size={11}
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Icon icon={Plus} size={11} strokeWidth={2.5} />
            )}
          </span>
          <input
            id={captureId ? QUICK_ADD_ID : undefined}
            ref={inputRef}
            type="text"
            name="title"
            maxLength={intent ? 2000 : 500}
            disabled={blocked}
            placeholder={placeholder}
            aria-label={t.todos.quickAddPlaceholder}
            aria-busy={busy || undefined}
            aria-describedby={busy ? statusId : undefined}
            onChange={(event) => setHasText(event.target.value.trim() !== '')}
            className="h-8 min-w-0 flex-1 border-0 bg-transparent p-0 text-[length:var(--text-body)] text-fg shadow-none placeholder:text-muted outline-none"
          />
          <fieldset
            disabled={blocked}
            className="ml-auto flex min-w-0 shrink-0 items-center gap-0.5 border-0 p-0 text-muted disabled:opacity-50"
          >
            {tools}
          </fieldset>
          <button
            type="submit"
            disabled={blocked}
            aria-label={t.todos.add}
            className={
              hasText || busy
                ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40'
                : 'sr-only'
            }
          >
            <Icon
              icon={busy ? LoaderCircle : CircleArrowUp}
              size={15}
              className={busy ? 'animate-spin motion-reduce:animate-none' : ''}
            />
          </button>
        </div>
        {progressNode}
        {errorNode}
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => void handle(event)}
      className="w-full min-w-0 self-stretch pb-4 pt-1"
    >
      <div className="field-shell flex h-[46px] w-full min-w-0 items-center gap-2 rounded-[14px] border border-border bg-surface px-4 shadow-[var(--shadow-xs)]">
        <span aria-hidden className="shrink-0 text-[17px] font-medium leading-none text-accent">
          {busy ? (
            <Icon
              icon={LoaderCircle}
              size={17}
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            '+'
          )}
        </span>
        <input
          id={captureId ? QUICK_ADD_ID : undefined}
          ref={inputRef}
          type="text"
          name="title"
          maxLength={intent ? 2000 : 500}
          disabled={blocked}
          placeholder={placeholder}
          aria-label={t.todos.quickAddPlaceholder}
          aria-busy={busy || undefined}
          aria-describedby={busy ? statusId : undefined}
          className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0.5 text-[length:var(--text-body)] text-fg shadow-none placeholder:text-muted outline-none"
        />
        <fieldset
          disabled={blocked}
          className="ml-auto flex min-w-0 shrink-0 items-center gap-1 border-0 p-0 text-muted disabled:opacity-50"
        >
          {tools}
        </fieldset>
        <button type="submit" disabled={blocked} className="sr-only">
          {t.todos.add}
        </button>
      </div>
      {progressNode}
      {errorNode}
    </form>
  );
});

function ListMenu({
  lists,
  value,
  onChange,
  placement = 'bottom',
}: {
  lists: List[];
  value: string;
  onChange: (id: string) => void;
  placement?: 'top' | 'bottom';
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popover = usePopover(popoverRef);
  const inbox = inboxList(lists);
  const options = [
    ...(inbox ? [{ id: inbox.id, name: t.lists.inbox, depth: 0 }] : []),
    ...listPickerRows(lists),
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
          className={`absolute right-0 z-[var(--z-dropdown)] max-h-56 w-44 overflow-y-auto ${
            placement === 'top' ? 'bottom-full mb-1' : 'mt-1'
          } ${FIELD_POPOVER_CLASS} p-1`}
        >
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] hover:bg-surface-muted ${
                item.id === value ? 'text-fg' : 'text-muted'
              } ${item.depth > 0 ? 'pl-5' : ''}`}
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
