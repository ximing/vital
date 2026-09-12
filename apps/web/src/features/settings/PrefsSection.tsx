import { bindServices, useService } from '@rabjs/react';
import type { FC } from 'react';
import { t } from '@/copy';
import { Banner } from '@/ui/banner';
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

function PrefsSectionContent() {
  const page = useService(PrefsSectionService);
  const user = page.auth.user;
  const zones = user && !ZONES.includes(user.timezone) ? [user.timezone, ...ZONES] : ZONES;

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
                  active ? 'bg-accent-subtle text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {page.error ? <Banner>{page.error}</Banner> : null}
    </div>
  );
}

export const PrefsSection: FC = bindServices(PrefsSectionContent, [PrefsSectionService]);
