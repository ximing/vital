import type { LucideIcon } from 'lucide-react';
import { BookOpen, Calendar, Folder, PanelLeftClose, PanelLeftOpen, Plus, Search, Sun } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { useInboxUi } from '@/features/inbox';
import { ActivationChecklist } from '@/features/onboarding';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { useTodosUi } from '@/features/todos';
import { AccountMenu } from '@/shell/AccountMenu';
import {
  loadPaneWidth,
  loadRailCollapsed,
  RAIL_COLLAPSED,
  RAIL_EXPANDED,
  savePaneWidth,
  saveRailCollapsed,
} from '@/shell/chrome';
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
  const [collapsed, setCollapsed] = useState(loadRailCollapsed);
  const [paneWidth, setPaneWidth] = useState(loadPaneWidth);
  const railW = collapsed ? RAIL_COLLAPSED : RAIL_EXPANDED;
  const chromeLeft = railW + (pane ? paneWidth : 0);

  function toggleRail() {
    const next = !collapsed;
    setCollapsed(next);
    saveRailCollapsed(next);
  }

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <aside
        className="fixed inset-y-0 left-0 z-[var(--z-sticky)] flex flex-col border-r border-border bg-surface"
        style={{ width: railW }}
        aria-label="主导航"
      >
        <div className={`flex shrink-0 items-center ${collapsed ? 'justify-center px-1 pt-4' : 'px-3 pt-5'} pb-2`}>
          <NavLink to={HOME_PATH} className="flex items-center gap-2" title={t.brand.wordmark}>
            <VitalMark className="h-8 w-8 shrink-0 text-accent" />
            {collapsed ? null : (
              <span className="truncate text-[length:var(--text-meta)] font-semibold tracking-[-0.03em]">
                {t.brand.wordmark}
              </span>
            )}
          </NavLink>
        </div>

        <div className={`pb-2 ${collapsed ? 'px-1' : 'px-2'}`}>
          <NavLink
            to="/search"
            title={t.nav.search}
            aria-label={t.nav.search}
            className={`flex h-9 items-center gap-2 text-[length:var(--text-meta)] ${
              collapsed ? 'justify-center' : 'px-2'
            } ${onSearch ? 'bg-surface-muted text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg'}`}
          >
            <Icon icon={Search} size={16} className="shrink-0" />
            {collapsed ? null : <span className="min-w-0 truncate">{t.nav.search}</span>}
          </NavLink>
        </div>

        <div className={`pb-3 ${collapsed ? 'px-1' : 'px-2'}`}>
          <button
            type="button"
            className={`flex min-h-[var(--control-h)] w-full items-center justify-center gap-1.5 rounded-2xl bg-accent font-medium text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover ${
              collapsed ? '' : 'text-[length:var(--text-meta)]'
            }`}
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
            {collapsed ? null : t.nav.quickAdd}
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
                className={`relative flex min-h-[var(--touch-min)] items-center gap-2 text-[length:var(--text-meta)] ${
                  collapsed ? 'justify-center px-0' : 'px-3'
                } ${
                  active
                    ? "bg-surface-muted text-fg before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent before:content-['']"
                    : 'text-muted hover:bg-surface-muted hover:text-fg'
                }`}
              >
                <Icon icon={item.icon} className="shrink-0 opacity-80" />
                {collapsed ? null : <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className={`px-1 pb-1 ${collapsed ? '' : 'px-2'}`}>
          <button
            type="button"
            className="flex h-9 w-full items-center justify-center text-muted hover:bg-surface-muted hover:text-fg"
            aria-pressed={collapsed}
            title={collapsed ? t.rail.expand : t.rail.collapse}
            aria-label={collapsed ? t.rail.expand : t.rail.collapse}
            onClick={toggleRail}
          >
            <Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} size={16} />
          </button>
        </div>
        <AccountMenu collapsed={collapsed} railWidth={railW} />
      </aside>

      {pane ? (
        <SecondaryPane
          section={section}
          left={railW}
          width={paneWidth}
          onResize={(next) => {
            setPaneWidth(next);
            savePaneWidth(next);
          }}
        />
      ) : null}

      <div style={{ paddingLeft: chromeLeft }}>
        <main id="main" className="min-h-screen">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <ActivationChecklist />
    </div>
  );
}
