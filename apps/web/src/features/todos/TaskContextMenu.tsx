import type { List, PatchTaskInput, Task } from '@vital/dto';
import { Folder } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '@/copy';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import {
  addDaysYmd,
  inboxList,
  todayYmd,
  userLists,
} from './model';
import { PriorityPicker } from './priority';
import { scheduleDayPatch } from './schedule-draft';

function Item({
  label,
  danger = false,
  onSelect,
}: {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] ${
        danger ? 'text-danger hover:bg-surface-muted' : 'text-fg hover:bg-surface-muted'
      }`}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 my-1 h-px bg-border/60" />;
}

export function TaskContextMenu({
  task,
  x,
  y,
  lists,
  timeZone,
  onClose,
  onOpen,
  onComplete,
  onPatch,
  onDelete,
}: {
  task: Task;
  x: number;
  y: number;
  lists: List[];
  timeZone: string;
  onClose: () => void;
  onOpen: () => void;
  onComplete: (task: Task) => void;
  onPatch: (task: Task, input: PatchTaskInput) => void;
  onDelete: (task: Task) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the viewport once we know its size.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const zone = task.timezone || timeZone;
  const today = todayYmd(zone);
  const inbox = inboxList(lists);
  const movable = task.parentId === null;
  const listOptions = [
    ...(inbox ? [{ id: inbox.id, name: t.lists.inbox }] : []),
    ...userLists(lists).map((list) => ({ id: list.id, name: list.name })),
  ];
  const done = task.status === 'done';

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)]"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={task.title}
        style={{ left: pos.left, top: pos.top }}
        className={`fixed w-60 ${FIELD_POPOVER_CLASS} p-1.5`}
        onClick={(event) => event.stopPropagation()}
      >
        <Item label={t.todos.openDetail} onSelect={act(onOpen)} />
        {done ? null : (
          <Item label={t.todos.complete} onSelect={act(() => onComplete(task))} />
        )}
        <Divider />
        <Item
          label={t.todos.scheduleToday}
          onSelect={act(() => onPatch(task, scheduleDayPatch(task, today, zone)))}
        />
        <Item
          label={t.todos.scheduleTomorrow}
          onSelect={act(() => onPatch(task, scheduleDayPatch(task, addDaysYmd(today, 1), zone)))}
        />
        {task.dueAt !== null || task.startAt !== null ? (
          <Item
            label={t.todos.clearDate}
            onSelect={act(() => onPatch(task, { startAt: null, dueAt: null, isAllDay: true }))}
          />
        ) : null}
        <Divider />
        <div className="px-1" role="group" aria-label={t.todos.priorityLabel}>
          <PriorityPicker
            value={task.priority}
            onChange={(priority) => {
              onPatch(task, { priority });
              onClose();
            }}
          />
        </div>
        {movable && listOptions.length > 0 ? (
          <>
            <Divider />
            <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[length:var(--text-caption)] text-tertiary">
              <Icon icon={Folder} size={12} />
              {t.todos.moveTo}
            </p>
            <div className="max-h-44 overflow-y-auto">
              {listOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="menuitem"
                  className={`flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] hover:bg-surface-muted ${
                    option.id === task.listId ? 'text-fg' : 'text-muted'
                  }`}
                  onClick={act(() => onPatch(task, { listId: option.id }))}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <Divider />
        <Item label={t.todos.deleteTask} danger onSelect={act(() => onDelete(task))} />
      </div>
    </div>
  );
}
