import { Bell, Palette, SlidersHorizontal, Sparkles, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { t } from '@/copy';
import { AccountSection } from '@/features/settings/AccountSection';
import { LlmSection } from '@/features/settings/LlmSection';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { PrefsSection } from '@/features/settings/PrefsSection';
import { ThemeToggle } from '@/shell/ThemeToggle';
import { Icon, type LucideIcon } from '@/ui/icon';

const TABS: {
  id: 'account' | 'appearance' | 'notifications' | 'prefs' | 'llm';
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'account', label: t.settings.tabs.account, icon: User },
  { id: 'appearance', label: t.settings.tabs.appearance, icon: Palette },
  { id: 'notifications', label: t.settings.tabs.notifications, icon: Bell },
  { id: 'prefs', label: t.settings.tabs.prefs, icon: SlidersHorizontal },
  { id: 'llm', label: t.settings.tabs.llm, icon: Sparkles },
];

function isTab(value: string | null): (typeof TABS)[number]['id'] {
  if (
    value === 'appearance' ||
    value === 'notifications' ||
    value === 'prefs' ||
    value === 'llm'
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
    <section className="rounded-xl bg-surface px-6 py-6">
      <h2 className="text-[length:var(--text-meta)] font-medium leading-[var(--text-meta-lh)] text-fg">
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
    <div data-region="settings-canvas" className="h-full min-h-0 w-full overflow-y-auto px-8 py-10 xl:px-12">
      <div className="w-full max-w-6xl">
        <h1 className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
          {t.settings.title}
        </h1>
        <p className="mt-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {t.empty.settings}
        </p>

        <div className="mt-8 flex flex-wrap gap-1" role="tablist" aria-label={t.settings.title}>
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSearch(item.id === 'account' ? {} : { tab: item.id })}
                className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] transition-[color,background-color] duration-[var(--ease-out)] ${
                  active ? 'bg-accent-subtle text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg'
                }`}
              >
                <Icon icon={item.icon} size={15} />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6" role="tabpanel">
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
        </div>
      </div>
    </div>
  );
}
