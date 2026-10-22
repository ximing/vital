import type { PatchTaskInput, Task } from '@vital/dto';
import { Ellipsis, Pin, X } from 'lucide-react';
import type { RefObject } from 'react';
import { t } from '@/copy';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { addDaysYmd, todayYmd } from './model';
import { PriorityMenu } from './priority';
import { draftToPatch, scheduleDayPatch, type ScheduleDraft } from './schedule-draft';
import { SchedulePopover } from './SchedulePopover';
import { ListPicker } from './ListPicker';
import { SaveStatus, type SaveState } from './SaveStatus';
import { TaskCheckbox } from './TaskRow';

export function TaskDetailHeader({
  task,
  zone,
  weekStartsOn,
  schedule,
  listenNonce,
  onShortcutOpen,
  runPatch,
  saveState,
  savedAt,
  onRetrySave,
  movable,
  listOptions,
  moreRef,
  moreMenu,
  onComplete,
  onDelete,
  onCloseDetail,
}: {
  task: Task;
  zone: string;
  weekStartsOn: 0 | 1;
  schedule: ScheduleDraft;
  listenNonce: number;
  onShortcutOpen: () => boolean;
  runPatch: (input: PatchTaskInput) => void;
  saveState: SaveState;
  savedAt: Date | null;
  onRetrySave: () => void;
  movable: boolean;
  listOptions: { id: string; name: string; depth?: number }[];
  moreRef: RefObject<HTMLDivElement | null>;
  moreMenu: { open: boolean; toggle: () => void; close: () => void };
  onComplete: (task: Task) => void;
  onDelete: () => void;
  onCloseDetail: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
      <TaskCheckbox
        task={task}
        timeZone={zone}
        className="mt-0"
        onToggle={() => onComplete(task)}
      />
      <SchedulePopover
        draft={schedule}
        zone={zone}
        weekStartsOn={weekStartsOn}
        align="end"
        listenNonce={listenNonce}
        onShortcutOpen={onShortcutOpen}
        onChange={(next) => runPatch(draftToPatch(next, zone))}
      />
      <div className="ml-auto flex items-center gap-1">
        <SaveStatus state={saveState} savedAt={savedAt} onRetry={onRetrySave} />
        {movable ? (
          <button
            type="button"
            aria-label={task.pinned ? t.todos.unpin : t.todos.pin}
            aria-pressed={task.pinned}
            onClick={() => runPatch({ pinned: !task.pinned })}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted ${
              task.pinned ? 'text-accent' : 'text-muted hover:text-fg'
            }`}
          >
            <Icon icon={Pin} size={15} fill={task.pinned ? 'currentColor' : 'none'} />
          </button>
        ) : null}
        <PriorityMenu value={task.priority} onChange={(priority) => runPatch({ priority })} />
        {movable ? (
          <ListPicker
            value={task.listId}
            options={listOptions}
            onChange={(listId) => runPatch({ listId })}
          />
        ) : null}
        <div ref={moreRef} className="relative">
          <button
            type="button"
            aria-label={t.todos.more}
            aria-expanded={moreMenu.open}
            onClick={() => moreMenu.toggle()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          >
            <Icon icon={Ellipsis} size={15} />
          </button>
          {moreMenu.open ? (
            <div
              role="menu"
              className={`absolute right-0 z-[var(--z-dropdown)] mt-1 w-44 ${FIELD_POPOVER_CLASS} p-1`}
            >
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] text-fg hover:bg-surface-muted"
                onClick={() => {
                  runPatch(scheduleDayPatch(task, todayYmd(zone), zone));
                  moreMenu.close();
                }}
              >
                {t.todos.scheduleToday}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] text-fg hover:bg-surface-muted"
                onClick={() => {
                  runPatch(scheduleDayPatch(task, addDaysYmd(todayYmd(zone), 1), zone));
                  moreMenu.close();
                }}
              >
                {t.todos.scheduleTomorrow}
              </button>
              {task.dueAt !== null || task.startAt !== null ? (
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] text-fg hover:bg-surface-muted"
                  onClick={() => {
                    runPatch({ startAt: null, dueAt: null, isAllDay: true });
                    moreMenu.close();
                  }}
                >
                  {t.todos.clearDate}
                </button>
              ) : null}
              <div className="mx-1 my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] text-danger hover:bg-surface-muted"
                onClick={() => {
                  onDelete();
                  moreMenu.close();
                }}
              >
                {t.todos.deleteTask}
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          onClick={() => onCloseDetail()}
          aria-label={t.todos.closeDetail}
        >
          <Icon icon={X} size={16} />
        </button>
      </div>
    </div>
  );
}
