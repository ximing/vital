import {
  Activity,
  Bell,
  Brain,
  ChartColumn,
  KeyRound,
  Palette,
  SlidersHorizontal,
  Sparkles,
  User,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { t } from '@/copy';
import { AccountSection } from '@/features/settings/AccountSection';
import { AgentActivitySection } from '@/features/settings/AgentActivitySection';
import { LlmSection } from '@/features/settings/LlmSection';
import { MemorySection } from '@/features/settings/MemorySection';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { PrefsSection } from '@/features/settings/PrefsSection';
import { TokensSection } from '@/features/settings/TokensSection';
import { UsageSection } from '@/features/settings/UsageSection';
import { ThemeToggle } from '@/shell/ThemeToggle';
import { Icon, type LucideIcon } from '@/ui/icon';
import { SelectField } from '@/ui/select-field';

const TABS: {
  id:
    | 'account'
    | 'appearance'
    | 'notifications'
    | 'prefs'
    | 'llm'
    | 'tokens'
    | 'usage'
    | 'activity'
    | 'memory';
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'account', label: t.settings.tabs.account, icon: User },
  { id: 'appearance', label: t.settings.tabs.appearance, icon: Palette },
  { id: 'notifications', label: t.settings.tabs.notifications, icon: Bell },
  { id: 'prefs', label: t.settings.tabs.prefs, icon: SlidersHorizontal },
  { id: 'llm', label: t.settings.tabs.llm, icon: Sparkles },
  { id: 'tokens', label: t.settings.tabs.tokens, icon: KeyRound },
  { id: 'usage', label: t.settings.tabs.usage, icon: ChartColumn },
  { id: 'activity', label: t.settings.tabs.activity, icon: Activity },
  { id: 'memory', label: t.settings.tabs.memory, icon: Brain },
];

function isTab(value: string | null): (typeof TABS)[number]['id'] {
  if (
    value === 'appearance' ||
    value === 'notifications' ||
    value === 'prefs' ||
    value === 'llm' ||
    value === 'tokens' ||
    value === 'usage' ||
    value === 'activity' ||
    value === 'memory'
  ) {
    return value;
  }
  return 'account';
}

export function SettingsBlock({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-border bg-surface px-6 py-6 shadow-[var(--shadow-xs)]">
      <h2 className="text-[length:var(--text-body)] font-semibold leading-[var(--text-body-lh)] text-fg">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {description}
        </p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const [search, setSearch] = useSearchParams();
  const tab = isTab(search.get('tab'));

  return (
    <div
      data-region="settings-canvas"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden sm:flex-row"
    >
      <aside className="shrink-0 border-b border-border bg-surface px-4 py-5 sm:w-52 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-4 sm:py-8 lg:w-60 lg:px-5">
        <div className="px-2">
          <h1 className="font-display text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)]">
            {t.settings.title}
          </h1>
          <p className="mt-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {t.empty.settings}
          </p>
        </div>

        <SelectField
          className="mt-4 sm:hidden"
          ariaLabel={t.settings.title}
          value={tab}
          options={TABS.map((item) => ({ value: item.id, label: item.label }))}
          onChange={(next) => setSearch(next === 'account' ? {} : { tab: next })}
        />

        <div
          className="mt-8 hidden flex-col gap-1 sm:flex"
          role="tablist"
          aria-orientation="vertical"
          aria-label={t.settings.title}
        >
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`settings-tab-${item.id}`}
                aria-controls="settings-panel"
                aria-selected={active}
                onClick={() => setSearch(item.id === 'account' ? {} : { tab: item.id })}
                className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] transition-colors duration-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  active
                    ? 'bg-accent-subtle font-medium text-accent'
                    : 'text-muted hover:bg-surface-muted hover:text-fg'
                }`}
              >
                <Icon icon={item.icon} size={17} />
                {item.label}
              </button>
            );
          })}
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:p-8 lg:px-12">
        <div
          id="settings-panel"
          className="mx-auto w-full max-w-4xl"
          role="tabpanel"
          aria-label={TABS.find((item) => item.id === tab)?.label}
        >
          {tab === 'account' ? (
            <SettingsBlock title={t.settings.account}>
              <AccountSection />
            </SettingsBlock>
          ) : null}
          {tab === 'appearance' ? (
            <SettingsBlock title={t.settings.appearance}>
              <ThemeToggle />
            </SettingsBlock>
          ) : null}
          {tab === 'notifications' ? (
            <SettingsBlock title={t.settings.notify.title} description={t.settings.notify.hint}>
              <NotificationsSection heading={false} />
            </SettingsBlock>
          ) : null}
          {tab === 'prefs' ? (
            <SettingsBlock title={t.settings.prefs}>
              <PrefsSection />
            </SettingsBlock>
          ) : null}
          {tab === 'llm' ? (
            <SettingsBlock title={t.settings.llm.title} description={t.settings.llm.hint}>
              <LlmSection />
            </SettingsBlock>
          ) : null}
          {tab === 'tokens' ? (
            <SettingsBlock title={t.settings.tokens.title} description={t.settings.tokens.hint}>
              <TokensSection />
            </SettingsBlock>
          ) : null}
          {tab === 'usage' ? (
            <SettingsBlock title={t.settings.usage.title} description={t.settings.usage.hint}>
              <UsageSection />
            </SettingsBlock>
          ) : null}
          {tab === 'activity' ? (
            <SettingsBlock title={t.settings.activity.title} description={t.settings.activity.hint}>
              <AgentActivitySection />
            </SettingsBlock>
          ) : null}
          {tab === 'memory' ? (
            <SettingsBlock title={t.settings.memory.title} description={t.settings.memory.hint}>
              <MemorySection />
            </SettingsBlock>
          ) : null}
        </div>
      </div>
    </div>
  );
}
