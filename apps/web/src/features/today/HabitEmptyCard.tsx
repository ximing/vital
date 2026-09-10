import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { habitTemplateInputs } from './model';
import { todayKeys } from './queries';

/**
 * Empty state for the habit lane on /today: one click enables a built-in
 * template (喝水 / 锻炼 / 阅读) through the normal habits create API.
 */
export function HabitEmptyCard() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const templates = habitTemplateInputs();

  async function enable(index: number) {
    const template = templates[index];
    if (!template) return;
    setPending(template.name);
    try {
      await client.createHabit(template);
      await qc.invalidateQueries({ queryKey: todayKeys.habits });
      await qc.invalidateQueries({ queryKey: todayKeys.dashboard });
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      data-region="habit-empty"
      className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-dashed border-border bg-surface px-3.5 py-2.5"
    >
      <span className="text-[length:var(--text-meta)] font-medium text-fg">
        {t.today.habitEmptyTitle}
      </span>
      <span className="hidden text-[length:var(--text-caption)] text-muted sm:inline">
        {t.today.habitEmptyHint}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {templates.map((template, index) => (
          <button
            key={template.name}
            type="button"
            disabled={pending !== null}
            aria-busy={pending === template.name}
            onClick={() => void enable(index)}
            className="h-7 rounded-full bg-accent-subtle px-2.5 text-[length:var(--text-caption)] font-medium text-accent transition-opacity duration-[var(--ease-out)] hover:opacity-75 disabled:opacity-50"
          >
            {template.name}
          </button>
        ))}
        <Link
          to="/settings?tab=habits"
          className="inline-flex h-7 items-center rounded-full px-2 text-[length:var(--text-caption)] font-medium text-muted transition-colors duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
        >
          {t.today.customHabit}
        </Link>
      </span>
    </div>
  );
}
