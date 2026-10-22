import type { Habit, HabitCheckin, Outcome, PatchHabitInput } from '@vital/dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Flame } from 'lucide-react';
import { useState } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { todayKeys } from '@/features/today';
import { ymdParts } from '@/lib/calendar-grid';
import { Icon } from '@/ui/icon';
import { HabitCheckinCalendar } from '../HabitCheckinCalendar';
import { BTN_GHOST_SM } from './classes';
import { dayMap, hitDays, monthRange, streakOf, todayOf } from './stats';

const copy = t.settings.habits;

/* ===== card ring ===== */

const CARD_C = 2 * Math.PI * 15.5;

function CardRing({ habit }: { habit: Habit }) {
  const { done, total, complete } = todayOf(habit);
  if (!habit.active) {
    return (
      <span
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-surface-muted text-[13px] text-tertiary"
        aria-hidden="true"
      >
        –
      </span>
    );
  }
  if (complete) {
    return (
      <span
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-done"
        aria-hidden="true"
      >
        <Icon icon={Check} size={15} className="text-on-accent" />
      </span>
    );
  }
  const progress = total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <span className="relative inline-flex h-[38px] w-[38px] shrink-0" aria-hidden="true">
      <svg viewBox="0 0 38 38" className="h-[38px] w-[38px] -rotate-90">
        <circle cx="19" cy="19" r="15.5" fill="none" strokeWidth="4" className="stroke-surface-muted" />
        {progress > 0 ? (
          <circle
            cx="19"
            cy="19"
            r="15.5"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={CARD_C}
            strokeDashoffset={CARD_C * (1 - progress)}
            className="stroke-accent"
          />
        ) : null}
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums ${done > 0 ? 'text-accent-deep' : 'text-tertiary'}`}
      >
        {habit.kind === 'count' ? `${done}/${total}` : done}
      </span>
    </span>
  );
}

function ActiveSwitch({
  active,
  disabled,
  onToggle,
}: {
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={copy.enableAria}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-[color,background-color,opacity] duration-[var(--ease-out)] disabled:opacity-50 group-hover:pointer-events-none group-hover:opacity-0 ${
        active ? 'bg-accent' : 'bg-surface-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-elevated shadow-[var(--shadow-xs)] transition-[left] duration-[var(--ease-out)] ${
          active ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export function HabitCard({
  habit,
  outcomes,
  days,
  statsDays,
  monthCursor,
  weekStartsOn,
  today,
  createdOn,
  onEdit,
}: {
  habit: Habit;
  outcomes: Outcome[];
  days: HabitCheckin['days'];
  statsDays: HabitCheckin['days'];
  monthCursor: string;
  weekStartsOn: 0 | 1;
  today: string;
  createdOn: string;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: todayKeys.all });
  const patch = useMutation({
    mutationFn: (input: PatchHabitInput) => client.patchHabit(habit.id, input),
    onSuccess: () => void invalidate(),
  });
  const remove = useMutation({
    mutationFn: () => client.deleteHabit(habit.id),
    onSuccess: () => void invalidate(),
  });

  const { done, total, complete } = todayOf(habit);
  const thread = outcomes.find((outcome) => outcome.id === habit.outcomeId);
  const subParts: { text: string; tone: 'plain' | 'hot' | 'thread' }[] = [
    {
      text:
        habit.kind === 'count'
          ? copy.countChip.replace('{n}', String(habit.targetCount ?? 0))
          : copy.dailyChip,
      tone: 'plain',
    },
  ];
  if (habit.windowStart && habit.windowEnd) {
    subParts.push({ text: `${habit.windowStart}–${habit.windowEnd}`, tone: 'plain' });
  }
  if (thread) subParts.push({ text: thread.name, tone: 'thread' });
  if (habit.active) {
    subParts.push({
      text: complete
        ? copy.todayDone
        : done > 0
          ? copy.todayProgress.replace('{done}', String(done)).replace('{total}', String(total))
          : copy.todayNone,
      tone: 'hot',
    });
  }

  // footer: streak is "now" (trailing range); month hit/eligible follows the visible month
  const streak = streakOf(dayMap(statsDays), total, createdOn, today);
  const { m } = ymdParts(monthCursor);
  const range = monthRange(monthCursor);
  const monthFrom = createdOn > range.from ? createdOn : range.from;
  const monthTo = range.to < today ? range.to : today;
  const { hit, eligible } =
    monthFrom > monthTo ? { hit: 0, eligible: 0 } : hitDays(dayMap(days), total, monthFrom, monthTo);

  return (
    <div
      data-habit-row={habit.id}
      data-habit-active={habit.active ? 'true' : 'false'}
      className={`group relative rounded-2xl border px-5 pb-3 pt-4 transition-[box-shadow,border-color,background-color] duration-[var(--ease-out)] ${
        habit.active
          ? 'border-border bg-surface hover:border-transparent hover:bg-elevated hover:shadow-[var(--shadow)]'
          : 'border-dashed border-border bg-transparent hover:bg-surface'
      }`}
    >
      <span className="absolute right-4 top-3.5 flex gap-0.5 opacity-0 transition-opacity duration-[var(--ease-out)] group-hover:opacity-100">
        <button type="button" onClick={onEdit} className={BTN_GHOST_SM}>
          {copy.edit}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${BTN_GHOST_SM} hover:text-danger`}
        >
          {copy.del}
        </button>
      </span>

      <div className={habit.active ? '' : 'opacity-50'}>
        <div className="flex items-center gap-3">
          <CardRing habit={habit} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[length:var(--text-body)] font-semibold text-fg">
              <span className="truncate">{habit.name}</span>
              {habit.createdBy === 'agent' ? (
                <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-accent-subtle px-[7px] text-[10px] font-semibold text-accent-deep">
                  {copy.agentBadge}
                </span>
              ) : null}
              {!habit.active ? (
                <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-surface-muted px-[7px] text-[10px] text-tertiary">
                  {copy.inactive}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[length:var(--text-caption)] text-muted">
              {subParts.map((part, index) => (
                <span key={index} className="flex items-center gap-1.5">
                  {index > 0 ? <span className="h-[3px] w-[3px] rounded-full bg-tertiary" /> : null}
                  <span
                    className={`truncate tabular-nums ${
                      part.tone === 'hot' && (done > 0 || complete)
                        ? 'font-semibold text-accent'
                        : part.tone === 'thread'
                          ? 'text-accent-deep'
                          : ''
                    }`}
                  >
                    {part.text}
                  </span>
                </span>
              ))}
            </p>
          </div>
          <ActiveSwitch
            active={habit.active}
            disabled={patch.isPending}
            onToggle={() => patch.mutate({ active: !habit.active })}
          />
        </div>

        {confirming ? (
          <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-danger/25 bg-danger/5 px-3 py-2">
            <p className="min-w-0 flex-1 text-[length:var(--text-caption)] font-medium text-danger">
              {copy.deleteConfirmBody.replace('{name}', habit.name)}
            </p>
            <button type="button" onClick={() => setConfirming(false)} className={BTN_GHOST_SM}>
              {copy.cancel}
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="inline-flex h-[26px] shrink-0 items-center rounded-full bg-danger px-3 text-[length:var(--text-caption)] font-semibold text-on-accent transition-opacity duration-[var(--ease-out)] hover:opacity-90 disabled:opacity-60"
            >
              {copy.confirmDelete}
            </button>
          </div>
        ) : (
          <>
            <HabitCheckinCalendar
              habit={habit}
              days={days}
              monthCursor={monthCursor}
              weekStartsOn={weekStartsOn}
              today={today}
              createdOn={createdOn}
              paused={!habit.active}
            />
            <p className="mt-2 flex items-center gap-1.5 border-t border-dashed border-border pt-2.5 text-[11px] text-tertiary">
              {habit.active ? (
                streak >= 2 ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-due">
                    <Icon icon={Flame} size={12} />
                    {copy.streak.replace('{n}', String(streak))}
                  </span>
                ) : (
                  <span>{copy.monthHit.replace('{m}', String(m)).replace('{n}', String(hit))}</span>
                )
              ) : (
                <span>{copy.pausedNote}</span>
              )}
              {habit.active ? (
                <span className="ml-auto tabular-nums">
                  {copy.monthDays
                    .replace('{m}', String(m))
                    .replace('{hit}', String(hit))
                    .replace('{days}', String(eligible))}
                </span>
              ) : null}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
