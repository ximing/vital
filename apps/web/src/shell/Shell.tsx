import type { LucideIcon } from 'lucide-react';
import { BookOpen, Calendar, Folder, Plus, Search, Settings, Sun } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { useInboxUi } from '@/features/inbox';
import { ActivationChecklist } from '@/features/onboarding';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { useTodosUi } from '@/features/todos';
import { useAuth } from '@/services/auth.service';
import { initialsOf } from '@/shell/rail-nav';
import { SecondaryPane } from '@/shell/SecondaryPane';
import { sectionOf, showsPane, type AppSection } from '@/shell/section';
import { ThemeToggle } from '@/shell/ThemeToggle';
import { VitalMark } from '@/shell/VitalMark';
import { Icon } from '@/ui/icon';

const PRIMARY: { id: AppSection; to: string; icon: LucideIcon; label: string }[] = [
  { id: 'rhythm', to: HOME_PATH, icon: Sun, label: t.rail.rhythm },
  { id: 'capture', to: '/inbox', icon: BookOpen, label: t.rail.capture },
  { id: 'lists', to: '/todos/lists/smart:inbox', icon: Folder, label: t.rail.lists },
  { id: 'reflect', to: '/reports', icon: Calendar, label: t.rail.reflect },
];

export function Shell() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();
  const requestQuickAdd = useTodosUi((s) => s.requestQuickAdd);
  const requestPaste = useInboxUi((s) => s.requestPaste);
  const section = sectionOf(location.pathname, location.search);
  const pane = showsPane(section);
  const onSearch = section === 'search';
  const onSettings = section === 'settings';
  const initials = initialsOf(user?.displayName ?? '');

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <aside
        className="fixed inset-y-0 left-0 z-[var(--z-sticky)] flex w-rail flex-col border-r border-border bg-surface"
        aria-label="主导航"
      >
        <div className="px-3 pb-2 pt-5">
          <NavLink to={HOME_PATH} className="flex items-center gap-2 px-0.5">
            <VitalMark className="h-7 w-7 shrink-0 text-accent" />
            <span className="truncate text-[length:var(--text-meta)] font-semibold tracking-[-0.03em]">
              {t.brand.wordmark}
            </span>
          </NavLink>
        </div>

        <div className="px-2 pb-2">
          <NavLink
            to="/search"
            aria-label={t.nav.search}
            className={`flex h-9 items-center gap-2 px-2 text-[length:var(--text-meta)] ${
              onSearch ? 'bg-surface-muted text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg'
            }`}
          >
            <Icon icon={Search} size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t.nav.search}</span>
          </NavLink>
        </div>

        <div className="px-2 pb-3">
          <button
            type="button"
            className="flex min-h-[var(--control-h)] w-full items-center justify-center gap-1.5 rounded-2xl bg-accent text-[length:var(--text-meta)] font-medium text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
            aria-label={t.nav.quickAdd}
            onClick={() => {
              if (section === 'capture') {
                requestPaste();
                if (!location.pathname.startsWith('/inbox')) navigate('/inbox');
                return;
              }
              requestQuickAdd();
              if (section !== 'rhythm' && section !== 'lists') navigate(HOME_PATH);
            }}
          >
            <Icon icon={Plus} size={16} />
            {t.nav.quickAdd}
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
          {PRIMARY.map((item) => {
            const active = section === item.id;
            return (
              <NavLink
                key={item.id}
                to={item.to}
                className={`relative flex min-h-[var(--touch-min)] items-center gap-2 px-3 text-[length:var(--text-meta)] ${
                  active
                    ? "bg-surface-muted text-fg before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent before:content-['']"
                    : 'text-muted hover:bg-surface-muted hover:text-fg'
                }`}
              >
                <Icon icon={item.icon} className="shrink-0 opacity-80" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-border">
          <NavLink
            to="/settings"
            className={`flex items-center gap-2 px-3 py-2.5 ${
              onSettings ? 'bg-surface-muted text-fg' : 'text-fg hover:bg-surface-muted'
            }`}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[length:var(--text-caption)] font-semibold leading-none"
              aria-hidden
            >
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[length:var(--text-meta)] leading-[var(--text-meta-lh)]">
                {user?.displayName ?? ''}
              </span>
              <span className="block text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                {t.nav.settings}
              </span>
            </span>
            <Icon icon={Settings} size={14} className="shrink-0 text-muted" />
          </NavLink>
          <div className="px-2 pb-3">
            <ThemeToggle compact />
          </div>
        </div>
      </aside>

      {pane ? <SecondaryPane section={section} /> : null}

      <div className={pane ? 'pl-chrome' : 'pl-rail'}>
        <main id="main" className="min-h-screen">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <ActivationChecklist />
    </div>
  );
}
