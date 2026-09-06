import { Bell, Palette, SlidersHorizontal, User } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { t } from '@/copy';
import { AccountSection } from '@/features/settings/AccountSection';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { PrefsSection } from '@/features/settings/PrefsSection';
import { ThemeToggle } from '@/shell/ThemeToggle';
import { Icon, type LucideIcon } from '@/ui/icon';

const TABS: { id: 'account' | 'appearance' | 'notifications' | 'prefs'; label: string; icon: LucideIcon }[] =
  [
    { id: 'account', label: t.settings.tabs.account, icon: User },
    { id: 'appearance', label: t.settings.tabs.appearance, icon: Palette },
    { id: 'notifications', label: t.settings.tabs.notifications, icon: Bell },
    { id: 'prefs', label: t.settings.tabs.prefs, icon: SlidersHorizontal },
  ];

function isTab(value: string | null): (typeof TABS)[number]['id'] {
  if (value === 'appearance' || value === 'notifications' || value === 'prefs') return value;
  return 'account';
}

export function SettingsPage() {
  const [search, setSearch] = useSearchParams();
  const tab = isTab(search.get('tab'));

  return (
    <div data-region="settings-canvas" className="mx-auto w-full max-w-5xl px-8 py-12 xl:px-10">
      <h1 className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
        {t.settings.title}
      </h1>
      <p className="mt-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {t.empty.settings}
      </p>

      <div
        className="mt-8 flex gap-1 rounded-lg border border-border bg-surface p-1"
        role="tablist"
        aria-label={t.settings.title}
      >
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSearch(item.id === 'account' ? {} : { tab: item.id })}
              className={`inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] transition-[color,background-color] duration-[var(--ease-out)] ${
                active ? 'bg-accent-subtle text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg'
              }`}
            >
              <Icon icon={item.icon} size={15} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mt-8" role="tabpanel">
        {tab === 'account' ? <AccountSection /> : null}
        {tab === 'appearance' ? <ThemeToggle /> : null}
        {tab === 'notifications' ? <NotificationsSection heading={false} /> : null}
        {tab === 'prefs' ? <PrefsSection /> : null}
      </div>
    </div>
  );
}
