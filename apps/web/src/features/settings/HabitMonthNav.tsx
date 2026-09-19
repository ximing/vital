import { ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '@/copy';
import { addMonthsYmd, ymdParts } from '@/lib/calendar-grid';
import { Icon } from '@/ui/icon';

const copy = t.settings.habits;

const NAV_BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted';

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
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={NAV_BTN}
        onClick={() => onChange(addMonthsYmd(monthCursor, -1))}
        aria-label={copy.calendarPrev}
      >
        <Icon icon={ChevronLeft} size={15} />
      </button>
      <p className="min-w-[88px] text-center text-[length:var(--text-meta)] font-semibold tabular-nums text-fg">
        {copy.calendarMonth.replace('{y}', String(y)).replace('{m}', String(m))}
      </p>
      <button
        type="button"
        disabled={!canNext}
        className={NAV_BTN}
        onClick={() => onChange(addMonthsYmd(monthCursor, 1))}
        aria-label={copy.calendarNext}
      >
        <Icon icon={ChevronRight} size={15} />
      </button>
      {monthCursor !== thisMonth ? (
        <button
          type="button"
          className="ml-1 inline-flex h-7 items-center rounded-md px-2 text-[length:var(--text-caption)] text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          onClick={() => onChange(thisMonth)}
        >
          {copy.backToday}
        </button>
      ) : null}
    </div>
  );
}
