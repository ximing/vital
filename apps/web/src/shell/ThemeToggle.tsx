import { client } from '@/api/client';
import { t } from '@/copy';
import type { ThemeChoice } from '@/lib/theme';
import { useAuthStore } from '@/state/auth-store';
import { useThemeStore } from '@/state/theme-store';

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: t.theme.system },
  { value: 'light', label: t.theme.light },
  { value: 'dark', label: t.theme.dark },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const choice = useThemeStore((s) => s.choice);
  const setChoice = useThemeStore((s) => s.setChoice);
  const user = useAuthStore((s) => s.user);

  function onChoose(next: ThemeChoice) {
    setChoice(next);
    if (user) {
      void client.updateMe({ themePreference: next }).catch(() => undefined);
    }
  }
  return (
    <div
      className={compact ? 'flex flex-col gap-1' : 'flex flex-wrap gap-1'}
      role="radiogroup"
      aria-label={t.theme.label}
    >
      {OPTIONS.map((option) => {
        const active = choice === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChoose(option.value)}
            className={`min-h-[var(--touch-min)] rounded-md px-2 text-left text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] transition-[color,background-color] duration-[var(--ease-out)] ${
              active
                ? 'bg-accent-subtle text-fg'
                : 'text-muted hover:bg-surface-muted hover:text-fg'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
