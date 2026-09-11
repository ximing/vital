import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { AgentActivitySection } from '@/features/settings/AgentActivitySection';
import { AgentMaintenanceButton } from '@/features/settings/AgentMaintenanceButton';
import { HabitsSection } from '@/features/settings/HabitsSection';
import { MemorySection } from '@/features/settings/MemorySection';
import { ThreadsSection } from '@/features/settings/ThreadsSection';
import { UsageSection } from '@/features/settings/UsageSection';
import { SettingsBlock } from '@/pages/settings';

function AICanvas({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="h-full min-h-0 w-full overflow-y-auto px-4 py-6 sm:p-8 lg:px-12">
      <div className="mx-auto w-full max-w-4xl">
        <SettingsBlock title={title} description={hint}>
          {children}
        </SettingsBlock>
      </div>
    </div>
  );
}

export function HabitsPage() {
  const [adding, setAdding] = useState(false);
  return (
    <div className="h-full min-h-0 w-full overflow-y-auto px-4 py-6 sm:p-8 lg:px-12">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <h1 className="font-display text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)]">
              {t.settings.habits.title}
            </h1>
            <p className="mt-1 max-w-xl text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
              {t.settings.habits.hint}
            </p>
          </div>
          <div className="ml-auto shrink-0 pt-1">
            {adding ? null : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex h-[30px] items-center rounded-full bg-accent px-3.5 text-[length:var(--text-meta)] font-semibold text-on-accent transition-[color,background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
              >
                + {t.settings.habits.add}
              </button>
            )}
          </div>
        </div>
        <div className="mt-6">
          <HabitsSection adding={adding} onDoneAdding={() => setAdding(false)} />
        </div>
      </div>
    </div>
  );
}

export function ThreadsPage() {
  return (
    <div className="h-full min-h-0 w-full overflow-y-auto px-4 py-6 sm:p-8 lg:px-12">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <h1 className="font-display text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)]">
              {t.settings.threads.title}
            </h1>
            <p className="mt-1 max-w-xl text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
              {t.settings.threads.hint}
            </p>
          </div>
          <div className="ml-auto shrink-0 pt-1">
            <Link
              to={HOME_PATH}
              className="inline-flex h-[30px] items-center rounded-full border border-border px-3.5 text-[length:var(--text-meta)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
            >
              {t.settings.threads.newAtToday}
            </Link>
          </div>
        </div>
        <div className="mt-6">
          <ThreadsSection />
        </div>
      </div>
    </div>
  );
}

export function ActivityPage() {
  return (
    <div className="h-full min-h-0 w-full overflow-y-auto px-4 py-6 sm:p-8 lg:px-12">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="font-display text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)]">
          {t.settings.activity.title}
        </h1>
        <p className="mt-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {t.settings.activity.hint}
        </p>
        <div className="mt-6">
          <AgentActivitySection />
        </div>
      </div>
    </div>
  );
}

export function MemoryPage() {
  const [adding, setAdding] = useState(false);
  return (
    <div className="h-full min-h-0 w-full overflow-y-auto px-4 py-6 sm:p-8 lg:px-12">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <h1 className="font-display text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)]">
              {t.settings.memory.title}
            </h1>
            <p className="mt-1 max-w-xl text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
              {t.settings.memory.hint}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-start gap-2 pt-1">
            <AgentMaintenanceButton kind="memory" />
            {adding ? null : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex h-[30px] items-center rounded-full bg-accent px-3.5 text-[length:var(--text-meta)] font-semibold text-on-accent transition-[color,background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
              >
                + {t.settings.memory.add}
              </button>
            )}
          </div>
        </div>
        <div className="mt-6">
          <MemorySection adding={adding} onDoneAdding={() => setAdding(false)} />
        </div>
      </div>
    </div>
  );
}

export function UsagePage() {
  return (
    <AICanvas title={t.settings.usage.title} hint={t.settings.usage.hint}>
      <UsageSection />
    </AICanvas>
  );
}
