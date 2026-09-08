import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { resolveTheme, type ThemeChoice } from '@/lib/theme';
import { useAuth } from '@/services/auth.service';
import { themeService } from '@/services/theme.service';
import { Icon } from '@/ui/icon';

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: t.theme.system, icon: Monitor },
  { value: 'light', label: t.theme.light, icon: Sun },
  { value: 'dark', label: t.theme.dark, icon: Moon },
];

function persistTheme(next: ThemeChoice, signedIn: boolean): void {
  themeService().setChoice(next);
  if (signedIn) {
    void client.updateMe({ themePreference: next }).catch(() => undefined);
  }
}

export function ThemeSwitch({ variant = 'menu' }: { variant?: 'menu' | 'rail' }) {
  const user = useAuth((s) => s.user);
  const [choice, setChoice] = useState(() => themeService().choice);
  const dark = resolveTheme(choice) === 'dark';

  function toggle() {
    const next = resolveTheme(themeService().choice) === 'dark' ? 'light' : 'dark';
    persistTheme(next, Boolean(user));
    setChoice(next);
  }

  if (variant === 'rail') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label={t.theme.switch}
        title={dark ? t.theme.dark : t.theme.light}
        onClick={toggle}
        className="relative mx-1 flex h-9 items-center justify-center rounded-md text-[length:var(--text-meta)] text-muted hover:bg-surface-muted hover:text-fg"
      >
        <Icon icon={dark ? Moon : Sun} className="shrink-0" />
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={t.theme.switch}
      onClick={toggle}
      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg hover:bg-surface-muted"
    >
      <span className="flex items-center gap-2">
        <Icon icon={dark ? Moon : Sun} size={16} />
        {dark ? t.theme.dark : t.theme.light}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-[background-color] duration-[var(--ease-out)] ${
          dark ? 'bg-accent' : 'bg-surface-muted'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-[left] duration-[var(--ease-out)] ${
            dark ? 'left-4' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const user = useAuth((s) => s.user);
  const [choice, setChoice] = useState(() => themeService().choice);

  function onChoose(next: ThemeChoice) {
    persistTheme(next, Boolean(user));
    setChoice(next);
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1" role="radiogroup" aria-label={t.theme.label}>
        {OPTIONS.map((option) => {
          const active = choice === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              title={option.label}
              onClick={() => onChoose(option.value)}
              className={`flex h-[var(--touch-min)] flex-1 items-center justify-center rounded-md transition-[color,background-color] duration-[var(--ease-out)] ${
                active
                  ? 'bg-accent-subtle text-fg'
                  : 'text-muted hover:bg-surface-muted hover:text-fg'
              }`}
            >
              <Icon icon={option.icon} />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t.theme.label}>
      {OPTIONS.map((option) => {
        const active = choice === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChoose(option.value)}
            className={`inline-flex min-h-[var(--touch-min)] items-center gap-2 rounded-md px-2 text-left text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] transition-[color,background-color] duration-[var(--ease-out)] ${
              active
                ? 'bg-accent-subtle text-fg'
                : 'text-muted hover:bg-surface-muted hover:text-fg'
            }`}
          >
            <Icon icon={option.icon} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
