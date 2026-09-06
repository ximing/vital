import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Calendar,
  CalendarClock,
  CircleCheck,
  Cloud,
  Folder,
  Inbox,
  Infinity as InfinityIcon,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { useInboxUi } from '@/features/inbox';
import { ActivationChecklist } from '@/features/onboarding';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { UserListsNav, useTodosUi } from '@/features/todos';
import { useAuth } from '@/services/auth.service';
import { initialsOf, railNavClass } from '@/shell/rail-nav';
import { ThemeToggle } from '@/shell/ThemeToggle';
import { VitalMark } from '@/shell/VitalMark';
import { Icon } from '@/ui/icon';

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-1 pt-4 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] font-medium text-muted">
      {children}
    </p>
  );
}

function RailLink({
  to,
  icon,
  children,
  isActive,
}: {
  to: string;
  icon: LucideIcon;
  children: string;
  isActive?: (args: { isActive: boolean }) => boolean;
}) {
  return (
    <NavLink
      to={to}
      className={(args) => railNavClass(isActive ? isActive(args) : args.isActive)}
    >
      <Icon icon={icon} className="shrink-0 opacity-80" />
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

export function Shell() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();
  const requestQuickAdd = useTodosUi((s) => s.requestQuickAdd);
  const requestPaste = useInboxUi((s) => s.requestPaste);
  const onReports = location.pathname.startsWith('/reports');
  const onSearch = location.pathname.startsWith('/search');
  const onSettings = location.pathname.startsWith('/settings');
  const initials = initialsOf(user?.displayName ?? '');

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <aside
        className="fixed inset-y-0 left-0 z-[var(--z-sticky)] flex w-rail flex-col border-r border-border bg-surface"
        aria-label="主导航"
      >
        <div className="px-3 pb-2 pt-5">
          <NavLink to="/todos/lists/smart:today" className="flex items-center gap-2 px-1">
            <VitalMark className="h-7 w-7 shrink-0 text-accent" />
            <span className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em] text-fg">
              {t.brand.wordmark}
            </span>
          </NavLink>
        </div>

        <div className="px-3 pb-2">
          <NavLink
            to="/search"
            aria-label={t.nav.search}
            className={`flex h-9 items-center gap-2 px-2.5 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] ${
              onSearch
                ? 'bg-surface-muted text-fg'
                : 'bg-canvas text-muted hover:text-fg'
            }`}
          >
            <Icon icon={Search} size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t.nav.search}</span>
            <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
              ⌘K
            </span>
          </NavLink>
        </div>

        <div className="px-3 pb-3">
          <button
            type="button"
            className="flex min-h-[var(--control-h-prominent)] w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[length:var(--text-body)] font-medium text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
            aria-label={t.nav.quickAdd}
            onClick={() => {
              if (location.pathname.startsWith('/inbox')) {
                requestPaste();
                if (location.pathname !== '/inbox') navigate('/inbox');
                return;
              }
              requestQuickAdd();
              if (!location.pathname.startsWith('/todos')) navigate(HOME_PATH);
            }}
          >
            <Icon icon={Plus} size={18} />
            {t.nav.quickAdd}
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
          <SectionLabel>{t.rail.rhythm}</SectionLabel>
          <RailLink to="/todos/lists/smart:today" icon={Sun}>
            {t.lists.today}
          </RailLink>
          <RailLink to="/todos/lists/smart:upcoming" icon={CalendarClock}>
            {t.lists.upcoming}
          </RailLink>
          <RailLink to="/todos/lists/smart:anytime" icon={InfinityIcon}>
            {t.lists.anytime}
          </RailLink>
          <RailLink to="/todos/lists/smart:someday" icon={Cloud}>
            {t.lists.someday}
          </RailLink>
          <RailLink to="/todos/lists/smart:done" icon={CircleCheck}>
            {t.lists.done}
          </RailLink>

          <SectionLabel>{t.rail.capture}</SectionLabel>
          <RailLink to="/inbox" icon={BookOpen}>
            {t.nav.inbox}
          </RailLink>
          <RailLink to="/todos/lists/smart:inbox" icon={Inbox}>
            {t.lists.inbox}
          </RailLink>

          <SectionLabel>{t.rail.lists}</SectionLabel>
          <UserListsNav icon={Folder} addIcon={Plus} />
        </nav>

        <div className="shrink-0 border-t border-border pt-1">
          <RailLink to="/reports" icon={Calendar} isActive={() => onReports}>
            {t.rail.reflect}
          </RailLink>
        </div>

        <div className="shrink-0 border-t border-border">
          <NavLink
            to="/settings"
            className={`flex items-center gap-2.5 px-3 py-2.5 ${
              onSettings ? 'bg-surface-muted text-fg' : 'text-fg hover:bg-surface-muted'
            }`}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[length:var(--text-caption)] font-semibold leading-none text-fg"
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
          <div className="px-3 pb-3">
            <ThemeToggle compact />
          </div>
        </div>
      </aside>

      <div className="pl-rail">
        <main id="main" className="min-h-screen">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <ActivationChecklist />
    </div>
  );
}
