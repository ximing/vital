import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { useInboxUi } from '@/features/inbox';
import { UserListsNav, useTodosUi } from '@/features/todos';
import { ThemeToggle } from '@/shell/ThemeToggle';
import { VitalMark } from '@/shell/VitalMark';
import { useAuthStore } from '@/state/auth-store';

const NAV_BASE =
  'relative flex min-h-[var(--touch-min)] items-center px-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] transition-[color,background-color] duration-[var(--ease-out)]';

function navClass({ isActive }: { isActive: boolean }): string {
  return `${NAV_BASE} ${
    isActive
      ? "bg-accent-subtle text-fg before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-accent before:content-['']"
      : 'text-muted hover:bg-surface-muted hover:text-fg'
  }`;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-1 pt-4 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
      {children}
    </p>
  );
}

export function Shell() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();
  const requestQuickAdd = useTodosUi((s) => s.requestQuickAdd);
  const requestPaste = useInboxUi((s) => s.requestPaste);

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
            className="flex min-h-[var(--control-h-prominent)] w-full items-center justify-center rounded-md bg-accent text-[length:var(--text-body)] text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
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
            {t.nav.quickAdd}
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
          <SectionLabel>{t.rail.rhythm}</SectionLabel>
          <NavLink to="/todos/lists/smart:today" className={navClass}>
            {t.lists.today}
          </NavLink>
          <NavLink to="/todos/lists/smart:upcoming" className={navClass}>
            {t.lists.upcoming}
          </NavLink>
          <NavLink to="/todos/lists/smart:anytime" className={navClass}>
            {t.lists.anytime}
          </NavLink>
          <NavLink to="/todos/lists/smart:someday" className={navClass}>
            {t.lists.someday}
          </NavLink>

          <SectionLabel>{t.rail.capture}</SectionLabel>
          <NavLink to="/inbox" className={navClass}>
            {t.nav.inbox}
          </NavLink>
          <p className="px-3 pt-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.rail.lists}
          </p>
          <NavLink to="/todos/lists/smart:inbox" className={navClass}>
            {t.lists.inbox}
          </NavLink>
          <UserListsNav />
          <NavLink to="/todos/lists/smart:done" className={navClass}>
            {t.lists.done}
          </NavLink>

          <SectionLabel>{t.rail.reflect}</SectionLabel>
          <NavLink
            to="/reports"
            className={() => {
              const type = new URLSearchParams(location.search).get('type');
              const onReports = location.pathname.startsWith('/reports');
              const daily =
                onReports && type !== 'weekly' && type !== 'monthly' && type !== 'yearly';
              return navClass({ isActive: daily });
            }}
          >
            {t.reports.daily}
          </NavLink>
          <NavLink
            to="/reports?type=weekly"
            className={() => {
              const type = new URLSearchParams(location.search).get('type');
              return navClass({
                isActive: location.pathname.startsWith('/reports') && type === 'weekly',
              });
            }}
          >
            {t.reports.weekly}
          </NavLink>

          <div className="mt-4">
            <NavLink to="/library" className={navClass}>
              {t.nav.library}
            </NavLink>
            <NavLink to="/settings" className={navClass}>
              {t.nav.settings}
            </NavLink>
          </div>
        </nav>

        <div className="shrink-0 px-3 py-3">
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
    </div>
  );
}
