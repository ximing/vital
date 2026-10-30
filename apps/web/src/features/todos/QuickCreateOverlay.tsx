import { llmReady } from '@vital/dto';
import { useService } from '@rabjs/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type FC } from 'react';
import { t } from '@/copy';
import { markOnboarding } from '@/features/onboarding/mark';
import { todayKeys } from '@/features/today/queries';
import { AuthService } from '@/services/auth.service';
import { Overlay } from '@/ui/overlay';
import { inboxList } from './model';
import { QuickAdd } from './QuickAdd';
import {
  CLOSE_QUICK_CREATE_EVENT,
  OPEN_QUICK_CREATE_EVENT,
  QUICK_CREATE_CLOSED_EVENT,
  isQuickCreatePin,
  quickCreateTask,
  type QuickCreateOpenDetail,
} from './quick-create';
import { todoKeys, useListsQuery } from './queries';
import type { ComposeExtras } from './QuickAdd';
import type { ScheduleDraft } from './schedule-draft';
import { TodosUiService } from './todos-ui.service';

/**
 * Global quick-create overlay (⌘N on the desktop menu, C in the browser,
 * rail ＋ button). Opens over any page — no navigation, no detail pane.
 */
export const QuickCreateOverlay: FC = () => {
  const auth = useService(AuthService);
  const todos = useService(TodosUiService);
  const queryClient = useQueryClient();
  const listsQuery = useListsQuery();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState<QuickCreateOpenDetail | null>(null);
  const [session, setSession] = useState(0);

  const close = useCallback((): void => {
    setOpen(false);
    setPinned(null);
    window.dispatchEvent(new CustomEvent(QUICK_CREATE_CLOSED_EVENT));
  }, []);

  useEffect(() => {
    function onOpen(event: Event): void {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      setPinned(isQuickCreatePin(detail) ? detail : null);
      setSession((value) => value + 1);
      setOpen(true);
    }
    window.addEventListener(OPEN_QUICK_CREATE_EVENT, onOpen);
    window.addEventListener(CLOSE_QUICK_CREATE_EVENT, close);
    return () => {
      window.removeEventListener(OPEN_QUICK_CREATE_EVENT, onOpen);
      window.removeEventListener(CLOSE_QUICK_CREATE_EVENT, close);
    };
  }, [close]);

  const lists = listsQuery.data ?? [];
  const inbox = inboxList(lists);
  const inboxId = inbox?.id ?? '';
  const timeZone = auth.user?.timezone ?? 'UTC';
  const weekStartsOn = auth.user?.weekStartsOn === 0 ? 0 : 1;
  const intent = llmReady(auth.user?.llm, 'task.parse');

  async function onSubmit(name: string, draft: ScheduleDraft, extras: ComposeExtras): Promise<void> {
    if (inboxId === '') return;
    const task = await quickCreateTask({
      name,
      draft,
      extras,
      inboxId,
      timeZone,
      intent,
      pinSchedule: pinned?.pinSchedule === true,
    });
    queryClient.setQueryData(todoKeys.item(task.id), task);
    todos.noteSimilarOpen(task.similarOpenTasks);
    await markOnboarding({ createdTask: true });
    await queryClient.invalidateQueries({ queryKey: todoKeys.all });
    await queryClient.invalidateQueries({ queryKey: todayKeys.all });
    close();
  }

  if (!open) return null;

  return (
    <Overlay
      tone="scrim"
      align="start"
      className="px-4 pt-[15vh]"
      onClose={close}
      closeOnEscape
      closeOnBackdrop
      backdropEvent="mousedown"
      lockFocus
      restoreFocus
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.todos.quickCreate.title}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {pinned ? (
          <p
            data-schedule-draft-range
            className="px-4 pt-3 font-mono text-[length:var(--text-meta)] text-muted"
          >
            {pinned.rangeLabel}
          </p>
        ) : null}
        <div className="px-1 pt-1">
          <QuickAdd
            key={session}
            variant="card"
            captureId={false}
            initialDraft={pinned?.draft}
            onSubmit={(name, draft, extras) => onSubmit(name, draft, extras)}
            disabled={!inboxId}
            listName={inbox?.name ?? ''}
            lists={lists}
            defaultListId={inboxId}
            zone={timeZone}
            weekStartsOn={weekStartsOn}
            intent={intent}
          />
        </div>
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[length:var(--text-caption)] text-muted">
          <span>
            <kbd className="rounded border border-border bg-surface-muted px-1 font-mono">↵</kbd>{' '}
            {t.todos.quickCreate.submit}
          </span>
          <span>
            <kbd className="rounded border border-border bg-surface-muted px-1 font-mono">Esc</kbd>{' '}
            {t.todos.quickCreate.close}
          </span>
          {intent ? (
            <span className="ml-auto">✦ {t.todos.quickCreate.intentHint}</span>
          ) : null}
        </div>
      </div>
    </Overlay>
  );
};
