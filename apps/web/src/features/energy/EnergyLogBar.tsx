import type { EnergyLog } from '@vital/dto';
import { useState } from 'react';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { useCreateEnergyLog, useEnergyLogsQuery } from './queries';

const LEVELS = [1, 2, 3, 4, 5] as const;

function clock(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

export function energyLogLabel(log: EnergyLog): string {
  const mood = log.mood ? ` · ${log.mood}` : '';
  const note = log.note ? ` · ${log.note}` : '';
  return `${t.days.energyLevel.replace('{n}', String(log.energy))}${mood}${note}`;
}

export function EnergyLogBar({ timeZone, todayYmd }: { timeZone: string; todayYmd: string }) {
  const logs = useEnergyLogsQuery(todayYmd);
  const create = useCreateEnergyLog();
  const [mood, setMood] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const items = logs.data?.items ?? [];

  async function save(energy: number) {
    setError(null);
    try {
      await create.mutateAsync({
        energy,
        mood,
        note: note.trim() === '' ? null : note.trim(),
      });
      setMood(null);
      setNote('');
    } catch (err) {
      setError(humanError(err));
    }
  }

  return (
    <section data-testid="energy-log" aria-label={t.today.energyTitle} className="px-1 pb-2 pt-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[13px] font-semibold">{t.today.energyTitle}</h2>
        <p className="text-[12px] text-tertiary">{t.today.energyHint}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label={t.today.energyLevels}>
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              data-testid={`energy-${level}`}
              aria-label={t.today.energyLevel.replace('{n}', String(level))}
              disabled={create.isPending}
              onClick={() => void save(level)}
              className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2.5 text-[length:var(--text-meta)] font-semibold tabular-nums ${
                level <= 2
                  ? 'bg-surface text-fg hover:bg-surface-muted'
                  : 'bg-accent-subtle text-accent-deep hover:bg-surface-muted'
              } disabled:opacity-60`}
            >
              {level}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.today.energyMood}>
          {t.today.energyMoods.map((word) => {
            const on = mood === word;
            return (
              <button
                key={word}
                type="button"
                aria-pressed={on}
                disabled={create.isPending}
                onClick={() => setMood(on ? null : word)}
                className={`inline-flex h-7 items-center rounded-full px-2.5 text-[12px] ${
                  on ? 'bg-accent-subtle font-semibold text-accent-deep' : 'text-muted hover:bg-surface-muted'
                }`}
              >
                {word}
              </button>
            );
          })}
        </div>
      </div>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={200}
        placeholder={t.today.energyNote}
        aria-label={t.today.energyNote}
        className={`${FIELD_CONTROL_CLASS} mt-2 w-full max-w-md text-[length:var(--text-meta)]`}
      />
      {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
      {items.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          {items.map((log) => (
            <li key={log.id}>
              <span className="tabular-nums text-tertiary">{clock(log.loggedAt, timeZone)}</span>{' '}
              {energyLogLabel(log)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
