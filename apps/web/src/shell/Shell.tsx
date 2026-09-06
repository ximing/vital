import type { LucideIcon } from 'lucide-react';
import { BookOpen, Calendar, Folder, Plus, Search, Sun } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { useInboxUi } from '@/features/inbox';
import { ActivationChecklist } from '@/features/onboarding';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { useTodosUi } from '@/features/todos';
import { AccountMenu } from '@/shell/AccountMenu';
import { loadPaneWidth, RAIL_WIDTH, savePaneWidth } from '@/shell/chrome';
import { SecondaryPane } from '@/shell/SecondaryPane';
import { sectionOf, showsPane, type AppSection } from '@/shell/section';
import { VitalMark } from '@/shell/VitalMark';
import { Icon } from '@/ui/icon';
import { useState } from 'react';

const PRIMARY: { id: AppSection; to: string; icon: LucideIcon; label: string }[] = [
  { id: 'rhythm', to: HOME_PATH, icon: Sun, label: t.rail.rhythm },
  { id: 'capture', to: '/inbox', icon: BookOpen, label: t.rail.capture },
  { id: 'lists', to: '/todos/lists/smart:inbox', icon: Folder, label: t.rail.lists },
  { id: 'reflect', to: '/reports', icon: Calendar, label: t.rail.reflect },
];

export function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const requestQuickAdd = useTodosUi((s) => s.requestQuickAdd);
  const requestPaste = useInboxUi((s) => s.requestPaste);
  const section = sectionOf(location.pathname, location.search);
  const pane = showsPane(section);
  const onSearch = section === 'search';
  const [paneWidth, setPaneWidth] = useState(loadPaneWidth);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-fg" data-layout="mineral-garden">
      <aside
        data-region="rail"
        className="flex h-full shrink-0 flex-col bg-surface"
        style={{ width: RAIL_WIDTH }}
        aria-label="主导航"
      >
        <div className="flex shrink-0 items-center justify-center px-1 pb-2 pt-4">
          <NavLink to={HOME_PATH} className="flex items-center justify-center" title={t.brand.wordmark}>
            <VitalMark className="h-8 w-8 shrink-0 text-accent" />
          </NavLink>
        </div>

        <div className="px-1 pb-2">
          <NavLink
            to="/search"
            title={t.nav.search}
            aria-label={t.nav.search}
            className={`flex h-9 items-center justify-center rounded-md text-[length:var(--text-meta)] ${
              onSearch ? 'bg-accent-subtle text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg'
            }`}
          >
            <Icon icon={Search} size={16} className="shrink-0" />
          </NavLink>
        </div>

        <div className="px-1 pb-3">
          <button
            type="button"
            className="flex h-9 w-full items-center justify-center rounded-md bg-accent-deep text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
            aria-label={t.nav.quickAdd}
            title={t.nav.quickAdd}
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
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
          {PRIMARY.map((item) => {
            const active = section === item.id;
            return (
              <NavLink
                key={item.id}
                to={item.to}
                title={item.label}
                aria-label={item.label}
                className={`relative mx-1 flex h-9 items-center justify-center rounded-md text-[length:var(--text-meta)] ${
                  active
                    ? "bg-accent-subtle text-fg before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:bg-accent before:content-['']"
                    : 'text-muted hover:bg-surface-muted hover:text-fg'
                }`}
              >
                <Icon icon={item.icon} className="shrink-0" />
              </NavLink>
            );
          })}
        </nav>

        <AccountMenu collapsed railWidth={RAIL_WIDTH} />
      </aside>

      {pane ? (
        <SecondaryPane
          section={section}
          width={paneWidth}
          onResize={(next) => {
            setPaneWidth(next);
            savePaneWidth(next);
          }}
        />
      ) : null}

      <div data-region="canvas" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <Outlet />
      </div>
      <CommandPalette />
      <ActivationChecklist />
    </div>
  );
}
