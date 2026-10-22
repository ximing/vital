import { Folder } from 'lucide-react';
import { useRef } from 'react';
import { t } from '@/copy';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { usePopover } from '@/ui/use-popover';

export function ListPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; name: string; depth?: number }[];
  onChange: (id: string) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popover = usePopover(popoverRef);
  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        aria-label={t.todos.list}
        aria-expanded={popover.open}
        onClick={() => popover.toggle()}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
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
              } ${(item.depth ?? 0) > 0 ? 'pl-5' : ''}`}
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
