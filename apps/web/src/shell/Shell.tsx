import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarFold,
  CalendarRange,
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
import { ThemeToggle } from '@/shell/ThemeToggle';
import { VitalMark } from '@/shell/VitalMark';
import { Icon } from '@/ui/icon';

const NAV_BASE =
  'relative flex min-h-[var(--touch-min)] items-center gap-2 px-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] transition-[color,background-color] duration-[var(--ease-out)]';

function navClass({ isActive }: { isActive: boolean }): string {
  return `${NAV_BASE} ${
    isActive
      ? "bg-accent-subtle text-fg before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-accent before:content-['']"
      : 'text-muted hover:bg-surface-muted hover:text-fg'
  }`;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-1 pt-4 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] font-medium tracking-wide text-muted">
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
      className={(args) => navClass({ isActive: isActive ? isActive(args) : args.isActive })}
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
  const reportType = new URLSearchParams(location.search).get('type');

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <aside
        className="fixed inset-y-0 left-0 z-[var(--z-sticky)] flex w-rail flex-col border-r border-border bg-surface"
        aria-label="主导航"
      >
        <div className="relative overflow-hidden px-4 pb-3 pt-5">
          <span className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 text-accent opacity-30">
            <VitalMark className="pulse-mark h-full w-full" />
          </span>
          <NavLink to="/todos/lists/smart:today" className="relative flex items-center gap-2">
            <VitalMark className="h-8 w-8 shrink-0 text-accent" />
            <span className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em] text-fg">
              {t.brand.wordmark}
            </span>
          </NavLink>
        </div>

        <div className="px-3 pb-2">
          <button
            type="button"
            className="flex min-h-[var(--control-h-prominent)] w-full items-center justify-center gap-2 rounded-md bg-accent text-[length:var(--text-body)] text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
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

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
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

          <SectionLabel>{t.rail.reflect}</SectionLabel>
          <RailLink
            to="/reports"
            icon={Calendar}
            isActive={() => onReports && reportType !== 'weekly' && reportType !== 'monthly' && reportType !== 'yearly'}
          >
            {t.reports.daily}
          </RailLink>
          <RailLink
            to="/reports?type=weekly"
            icon={CalendarRange}
            isActive={() => onReports && reportType === 'weekly'}
          >
            {t.reports.weekly}
          </RailLink>
          <RailLink
            to="/reports?type=monthly"
            icon={CalendarDays}
            isActive={() => onReports && reportType === 'monthly'}
          >
            {t.reports.monthly}
          </RailLink>
          <RailLink
            to="/reports?type=yearly"
            icon={CalendarFold}
            isActive={() => onReports && reportType === 'yearly'}
          >
            {t.reports.yearly}
          </RailLink>

          <div className="mt-4 border-t border-border pt-2">
            <RailLink to="/search" icon={Search}>
              {t.nav.search}
            </RailLink>
            <RailLink to="/settings" icon={Settings}>
              {t.nav.settings}
            </RailLink>
          </div>
        </nav>

        <div className="shrink-0 border-t border-border px-3 py-3">
          <ThemeToggle compact />
          {user ? (
            <p className="mt-2 truncate px-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
              {user.displayName}
            </p>
          ) : null}
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
