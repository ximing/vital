import { bindServices, useService } from '@rabjs/react';
import {
  DEFAULT_DAILY_MODEL_CALL_LIMIT,
  MAX_DAILY_MODEL_CALL_LIMIT,
  MIN_DAILY_MODEL_CALL_LIMIT,
} from '@vital/dto';
import { useState, type FC } from 'react';
import { t } from '@/copy';
import { Banner } from '@/ui/banner';
import { Field } from '@/ui/field';
import { SelectField } from '@/ui/select-field';
import { PrefsSectionService } from './prefs.service';

const ZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'Australia/Sydney',
];

function limitRangeMessage(): string {
  return t.settings.dailyModelCallLimitInvalid
    .replace('{min}', String(MIN_DAILY_MODEL_CALL_LIMIT))
    .replace('{max}', String(MAX_DAILY_MODEL_CALL_LIMIT));
}

function PrefsSectionContent() {
  const page = useService(PrefsSectionService);
  const user = page.auth.user;
  const zones = user && !ZONES.includes(user.timezone) ? [user.timezone, ...ZONES] : ZONES;
  const savedLimit = user?.dailyModelCallLimit ?? DEFAULT_DAILY_MODEL_CALL_LIMIT;
  const [limitDraft, setLimitDraft] = useState(String(savedLimit));
  const [limitError, setLimitError] = useState('');
  const [syncedLimit, setSyncedLimit] = useState(savedLimit);
  if (savedLimit !== syncedLimit) {
    setSyncedLimit(savedLimit);
    setLimitDraft(String(savedLimit));
    setLimitError('');
  }

  function commitLimit(raw: string) {
    const next = Number(raw.trim());
    if (
      !Number.isInteger(next) ||
      next < MIN_DAILY_MODEL_CALL_LIMIT ||
      next > MAX_DAILY_MODEL_CALL_LIMIT
    ) {
      setLimitError(limitRangeMessage());
      return;
    }
    setLimitError('');
    setLimitDraft(String(next));
    if (next === savedLimit) return;
    void page.patch({ dailyModelCallLimit: next });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <label className="flex flex-col gap-1">
        <span className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {t.settings.timezone}
        </span>
        <SelectField
          value={user?.timezone ?? 'UTC'}
          ariaLabel={t.settings.timezone}
          options={zones.map((zone) => ({ value: zone, label: zone }))}
          onChange={(timezone) => void page.patch({ timezone })}
        />
      </label>
      <div role="radiogroup" aria-label={t.settings.weekStartsOn}>
        <p className="mb-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {t.settings.weekStartsOn}
        </p>
        <div className="flex gap-1">
          {(
            [
              [0, t.settings.weekSun],
              [1, t.settings.weekMon],
            ] as const
          ).map(([value, label]) => {
            const active = (user?.weekStartsOn ?? 1) === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void page.patch({ weekStartsOn: value })}
                className={`min-h-[var(--touch-min)] rounded-md px-3 text-[length:var(--text-meta)] ${
                  active
                    ? 'bg-accent-subtle text-fg'
                    : 'text-muted hover:bg-surface-muted hover:text-fg'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <Field
          label={t.settings.dailyModelCallLimit}
          type="number"
          inputMode="numeric"
          min={MIN_DAILY_MODEL_CALL_LIMIT}
          max={MAX_DAILY_MODEL_CALL_LIMIT}
          step={1}
          value={limitDraft}
          error={limitError}
          onChange={(event) => {
            setLimitDraft(event.target.value);
            if (limitError) setLimitError('');
          }}
          onBlur={(event) => commitLimit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {t.settings.dailyModelCallLimitHint.replace(
            '{n}',
            String(DEFAULT_DAILY_MODEL_CALL_LIMIT),
          )}
        </p>
      </div>
      {page.error ? <Banner>{page.error}</Banner> : null}
    </div>
  );
}

export const PrefsSection: FC = bindServices(PrefsSectionContent, [PrefsSectionService]);
