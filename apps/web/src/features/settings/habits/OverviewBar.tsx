import type { Habit, HabitCheckin } from '@vital/dto';
import { t } from '@/copy';
import { formatYmd } from '@/features/todos/model';
import { dayMap, hitDays, todayOf, weekStartYmd } from './stats';

const copy = t.settings.habits;

/* ===== overview bar ===== */

const OV_C = 2 * Math.PI * 33;

function OverviewRing({ done, total }: { done: number; total: number }) {
  const progress = total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <span className="relative inline-flex h-[76px] w-[76px] shrink-0" aria-hidden="true">
      <svg viewBox="0 0 76 76" className="h-[76px] w-[76px] -rotate-90">
        <circle cx="38" cy="38" r="33" fill="none" strokeWidth="7" className="stroke-surface-muted" />
        {progress > 0 ? (
          <circle
            cx="38"
            cy="38"
            r="33"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={OV_C}
            strokeDashoffset={OV_C * (1 - progress)}
            className="stroke-accent"
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <b className="font-display text-[19px] font-bold leading-none text-accent-deep tabular-nums">
          {done}/{total}
        </b>
        <span className="mt-1 text-[10px] leading-none text-tertiary">{copy.ov.today}</span>
      </span>
    </span>
  );
}

function OvStat({
  value,
  unit,
  label,
  hot = false,
}: {
  value: string;
  unit?: string;
  label: string;
  hot?: boolean;
}) {
  return (
    <span className="border-l border-border pl-6 text-right first:border-l-0 first:pl-0">
      <span
        className={`block font-display text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] tabular-nums ${hot ? 'text-accent-deep' : 'text-fg'}`}
      >
        {value}
        {unit ? (
          <span className="ml-0.5 text-[length:var(--text-caption)] font-medium text-tertiary">
            {unit}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block text-[11px] text-tertiary">{label}</span>
    </span>
  );
}

export function OverviewBar({
  habits,
  statsItems,
  zone,
  weekStartsOn,
  today,
}: {
  habits: Habit[];
  statsItems: HabitCheckin[] | undefined;
  zone: string;
  weekStartsOn: 0 | 1;
  today: string;
}) {
  const active = habits.filter((habit) => habit.active);
  const todayDone = active.reduce((sum, habit) => sum + todayOf(habit).done, 0);
  const todayTotal = active.reduce((sum, habit) => sum + todayOf(habit).total, 0);
  const remaining = active.reduce(
    (sum, habit) => sum + Math.max(0, todayOf(habit).total - todayOf(habit).done),
    0,
  );

  const title =
    todayTotal === 0
      ? copy.ov.titleNone
      : remaining === 0
        ? copy.ov.titleAll
        : todayDone > 0
          ? copy.ov.titleSome
          : copy.ov.titleNone;
  const sub =
    todayTotal === 0
      ? copy.ov.noActive
      : remaining === 0
        ? copy.ov.remainAll
        : copy.ov.remain.replace('{n}', String(remaining));

  const byHabit = new Map((statsItems ?? []).map((row) => [row.habitId, dayMap(row.days)]));
  const weekStart = weekStartYmd(today, weekStartsOn);
  let weekHit = 0;
  let weekEligible = 0;
  for (const habit of active) {
    const createdOn = formatYmd(new Date(habit.createdAt), zone);
    const from = createdOn > weekStart ? createdOn : weekStart;
    if (from > today) continue;
    const { hit, eligible } = hitDays(
      byHabit.get(habit.id) ?? new Map(),
      todayOf(habit).total,
      from,
      today,
    );
    weekHit += hit;
    weekEligible += eligible;
  }
  const weekRate = weekEligible > 0 ? Math.round((100 * weekHit) / weekEligible) : null;
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthCount = (statsItems ?? []).reduce(
    (sum, row) =>
      sum + row.days.reduce((acc, day) => (day.date >= monthStart ? acc + day.done : acc), 0),
    0,
  );

  return (
    <div className="relative flex flex-wrap items-center gap-x-7 gap-y-4 overflow-hidden rounded-[20px] bg-elevated px-7 py-5 shadow-[var(--shadow)]">
      <span className="absolute bottom-0 left-0 top-0 w-1 bg-accent" aria-hidden="true" />
      <OverviewRing done={todayDone} total={todayTotal} />
      <div className="min-w-0">
        <p className="font-display text-[length:var(--text-section)] font-semibold leading-[var(--text-section-lh)]">
          {title}
        </p>
        <p className="mt-1 max-w-md text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {sub}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-6">
        <OvStat value={String(active.length)} unit={copy.stats.unit} label={copy.stats.active} hot />
        <OvStat value={weekRate === null ? '—' : `${weekRate}%`} label={copy.ov.weekRate} />
        <OvStat value={String(monthCount)} unit={copy.ov.unitTimes} label={copy.ov.monthCount} />
      </div>
    </div>
  );
}
