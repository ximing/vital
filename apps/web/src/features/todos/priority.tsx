import { Circle, Flag } from 'lucide-react';
import type { TaskPriority } from '@vital/dto';
import { useRef } from 'react';
import { t } from '@/copy';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { usePopover } from '@/ui/use-popover';
import { priorityLabel } from './model';

const TONE: Record<TaskPriority, string> = {
  0: 'text-overdue',
  1: 'text-due',
  2: 'text-doing',
  3: 'text-muted',
};

const BAR: Record<TaskPriority, string> = {
  0: 'bg-overdue',
  1: 'bg-due',
  2: 'bg-doing',
  3: 'bg-border',
};

export function priorityBarClass(priority: TaskPriority): string {
  return BAR[priority];
}

export function priorityToneClass(priority: TaskPriority): string {
  return TONE[priority];
}

export function PriorityMark({
  priority,
  className = '',
}: {
  priority: TaskPriority;
  className?: string;
}) {
  if (priority === 3) return null;
  const label = t.todos.priority[priorityLabel(priority)];
  if (priority === 0) {
    return (
      <span className={`inline-flex items-center ${TONE[0]} ${className}`} title={label}>
        <Icon icon={Circle} size={9} fill="currentColor" strokeWidth={0} />
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center ${TONE[priority]} ${className}`} title={label}>
      <Icon icon={Flag} size={12} fill={priority === 1 ? 'currentColor' : 'none'} />
    </span>
  );
}

export function PriorityMenu({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popover = usePopover(popoverRef);
  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        aria-label={t.todos.priorityLabel}
        aria-expanded={popover.open}
        onClick={() => popover.toggle()}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface hover:text-fg ${
          value < 3 ? TONE[value] : 'text-muted'
        }`}
      >
        <Icon icon={Flag} size={15} fill={value === 1 ? 'currentColor' : 'none'} />
      </button>
      {popover.open ? (
        <div
          role="menu"
          className={`absolute left-0 z-[var(--z-dropdown)] mt-1 w-36 ${FIELD_POPOVER_CLASS} p-1`}
        >
          {([0, 1, 2, 3] as TaskPriority[]).map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[length:var(--text-caption)] hover:bg-surface-muted ${
                value === p ? 'text-fg' : 'text-muted'
              }`}
              onClick={() => {
                onChange(p);
                popover.close();
              }}
            >
              <PriorityMark priority={p} />
              {t.todos.priority[priorityLabel(p)]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PriorityPicker({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
}) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={t.todos.priorityLabel}>
      {([0, 1, 2, 3] as TaskPriority[]).map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            className={`inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg text-[length:var(--text-caption)] ${
              active ? `${TONE[p]} bg-surface-muted` : 'text-muted hover:bg-surface-muted'
            }`}
            onClick={() => onChange(p)}
          >
            <PriorityMark priority={p} />
            {t.todos.priority[priorityLabel(p)]}
          </button>
        );
      })}
    </div>
  );
}
