import type { ReactNode } from 'react';
import { t } from '@/copy';
import { AgentActivitySection } from '@/features/settings/AgentActivitySection';
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
  return (
    <AICanvas title={t.settings.habits.title} hint={t.settings.habits.hint}>
      <HabitsSection />
    </AICanvas>
  );
}

export function ThreadsPage() {
  return (
    <AICanvas title={t.settings.threads.title} hint={t.settings.threads.hint}>
      <ThreadsSection />
    </AICanvas>
  );
}

export function ActivityPage() {
  return (
    <AICanvas title={t.settings.activity.title} hint={t.settings.activity.hint}>
      <AgentActivitySection />
    </AICanvas>
  );
}

export function MemoryPage() {
  return (
    <AICanvas title={t.settings.memory.title} hint={t.settings.memory.hint}>
      <MemorySection />
    </AICanvas>
  );
}

export function UsagePage() {
  return (
    <AICanvas title={t.settings.usage.title} hint={t.settings.usage.hint}>
      <UsageSection />
    </AICanvas>
  );
}
