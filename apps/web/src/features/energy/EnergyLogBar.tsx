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
  const [detail, setDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = [...(logs.data?.items ?? [])].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const latest = items[items.length - 1];
  const earlier = items.slice(0, -1);
  const latestQuiet = latest
    ? [clock(latest.loggedAt, timeZone), latest.mood, latest.note].filter((part) => part !== null && part !== '').join(' · ')
    : '';

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
    <section data-testid="energy-log" aria-label={t.today.energyTitle}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[length:var(--text-meta)] text-tertiary">{t.today.energyMark}</span>
        <div className="flex gap-1" role="group" aria-label={t.today.energyLevels}>
          {LEVELS.map((level) => {
            const on = latest?.energy === level;
            return (
              <button
                key={level}
                type="button"
                data-testid={`energy-${level}`}
                aria-label={t.today.energyLevel.replace('{n}', String(level))}
                aria-pressed={on}
                disabled={create.isPending}
                onClick={() => void save(level)}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums disabled:opacity-60 ${
                  on
                    ? 'bg-accent-deep text-on-accent'
                    : 'border border-border text-fg hover:bg-surface-muted'
                }`}
              >
                {level}
              </button>
            );
          })}
        </div>
        {latestQuiet !== '' ? (
          <span className="text-[12px] text-muted">{latestQuiet}</span>
        ) : null}
        <button
          type="button"
          aria-expanded={detail}
          onClick={() => setDetail((open) => !open)}
          className="text-[12px] text-tertiary hover:text-fg"
        >
          {detail ? t.today.energyDetailClose : t.today.energyDetail}
        </button>
      </div>
      {detail ? (
        <div className="mt-2 space-y-2">
          <p className="text-[12px] text-tertiary">{t.today.energyHint}</p>
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
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            placeholder={t.today.energyNote}
            aria-label={t.today.energyNote}
            className={`${FIELD_CONTROL_CLASS} w-full max-w-md text-[length:var(--text-meta)]`}
          />
        </div>
      ) : null}
      {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
      {earlier.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          {earlier.map((log) => (
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
