import { Monitor, Moon, Sun } from 'lucide-react';
import { client } from '@/api/client';
import { t } from '@/copy';
import type { ThemeChoice } from '@/lib/theme';
import { useAuth } from '@/services/auth.service';
import { useThemeService } from '@/services/theme.service';
import { Icon } from '@/ui/icon';

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: t.theme.system, icon: Monitor },
  { value: 'light', label: t.theme.light, icon: Sun },
  { value: 'dark', label: t.theme.dark, icon: Moon },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const choice = useThemeService((s) => s.choice);
  const setChoice = useThemeService((s) => s.setChoice);
  const user = useAuth((s) => s.user);

  function onChoose(next: ThemeChoice) {
    setChoice(next);
    if (user) {
      void client.updateMe({ themePreference: next }).catch(() => undefined);
    }
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
