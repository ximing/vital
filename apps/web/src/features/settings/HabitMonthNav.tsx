import { ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '@/copy';
import { addMonthsYmd, ymdParts } from '@/lib/calendar-grid';
import { Icon } from '@/ui/icon';

const copy = t.settings.habits;

export function HabitMonthNav({
  monthCursor,
  today,
  onChange,
}: {
  monthCursor: string;
  today: string;
  onChange: (next: string) => void;
}) {
  const { y, m } = ymdParts(monthCursor);
  const thisMonth = `${today.slice(0, 7)}-01`;
  const canNext = monthCursor < thisMonth;
  return (
    <div className="flex items-center justify-between px-2 pb-1">
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-fg"
        onClick={() => onChange(addMonthsYmd(monthCursor, -1))}
        aria-label={copy.calendarPrev}
      >
        <Icon icon={ChevronLeft} size={16} />
      </button>
      <p className="text-[length:var(--text-meta)] font-medium text-fg">
        {copy.calendarMonth.replace('{y}', String(y)).replace('{m}', String(m))}
      </p>
      <button
        type="button"
        disabled={!canNext}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-fg disabled:opacity-30"
        onClick={() => onChange(addMonthsYmd(monthCursor, 1))}
        aria-label={copy.calendarNext}
      >
        <Icon icon={ChevronRight} size={16} />
      </button>
    </div>
  );
}
