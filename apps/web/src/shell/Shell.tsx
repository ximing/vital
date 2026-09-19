import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Brain,
  CalendarDays,
  ChartColumn,
  History,
  Inbox,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  Search,
  Settings,
  Sun,
  Waypoints,
} from 'lucide-react';
import { bindServices, useService } from '@rabjs/react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Suspense, useState, type FC } from 'react';
import { t } from '@/copy';
import { HOME_PATH, TODOS_HOME_PATH } from '@/routes';
import { ActivationChecklist } from '@/features/onboarding/ActivationChecklist';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { OPEN_PALETTE_EVENT } from '@/features/palette/model';
import { InboxUiService } from '@/features/inbox';
import { ReportUiService } from '@/features/reports/report-ui.service';
import { SimilarOpenToast, TodosUiService } from '@/features/todos';
import { AccountMenu } from '@/shell/AccountMenu';
import {
  loadPaneWidth,
  loadRailCollapsed,
  RAIL_COLLAPSED,
  RAIL_EXPANDED,
  savePaneWidth,
  saveRailCollapsed,
  type PaneSection,
} from '@/shell/chrome';
import { SecondaryPane } from '@/shell/SecondaryPane';
import { sectionOf, showsPane, type AppSection } from '@/shell/section';
import { ThemeSwitch } from '@/shell/ThemeToggle';
import { VitalMark } from '@/shell/VitalMark';
import { RouteFallback } from '@/shell/route-fallback';
import { Icon } from '@/ui/icon';

const PRIMARY: { id: AppSection; to: string; icon: LucideIcon; label: string }[] = [
  { id: 'today', to: HOME_PATH, icon: Sun, label: t.rail.today },
  { id: 'todos', to: TODOS_HOME_PATH, icon: ListChecks, label: t.rail.todos },
  { id: 'capture', to: '/inbox', icon: Inbox, label: t.rail.capture },
  { id: 'habits', to: '/habits', icon: Repeat, label: t.rail.habits },
  { id: 'reflect', to: '/reports', icon: History, label: t.rail.reflect },
  { id: 'days', to: '/days', icon: CalendarDays, label: t.rail.days },
  { id: 'threads', to: '/threads', icon: Waypoints, label: t.rail.threads },
];

const AI_NAV: { id: AppSection; to: string; icon: LucideIcon; label: string }[] = [
  { id: 'activity', to: '/activity', icon: Activity, label: t.rail.activity },
  { id: 'memory', to: '/memory', icon: Brain, label: t.rail.memory },
];

function railItemClass(active: boolean, collapsed: boolean): string {
  return `relative mx-1 flex h-9 items-center rounded-md text-[length:var(--text-meta)] ${
    collapsed ? 'justify-center' : 'gap-2 px-3'
  } ${
    active
      ? "bg-accent-subtle text-accent before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-accent before:content-['']"
      : 'text-muted hover:bg-surface-muted hover:text-fg'
  }`;
}

function ShellContent() {
  const todos = useService(TodosUiService);
  const location = useLocation();
  const section = sectionOf(location.pathname, location.search);
  const paneSection: PaneSection | null = showsPane(section) ? (section as PaneSection) : null;
  const [collapsed, setCollapsed] = useState<boolean>(() => loadRailCollapsed());
  const railWidth = collapsed ? RAIL_COLLAPSED : RAIL_EXPANDED;
  const [paneWidths, setPaneWidths] = useState<Record<PaneSection, number>>(() => ({
    todos: loadPaneWidth('todos'),
    capture: loadPaneWidth('capture'),
    reflect: loadPaneWidth('reflect'),
  }));

  function toggleRail() {
    setCollapsed((prev) => {
      saveRailCollapsed(!prev);
      return !prev;
    });
  }

  return (
    <div className="flex h-full overflow-hidden bg-canvas text-fg" data-layout="mineral-garden">
      <aside
        data-region="rail"
        data-collapsed={collapsed || undefined}
        className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-surface transition-[width] duration-200"
        style={{ width: railWidth }}
        aria-label="主导航"
      >
        <div
          className={`flex shrink-0 items-center pb-2 pt-4 ${
            collapsed ? 'justify-center px-1' : 'gap-2 px-4'
          }`}
        >
          <NavLink
            to={HOME_PATH}
            className="flex shrink-0 items-center justify-center"
            title={collapsed ? t.brand.wordmark : undefined}
          >
            <VitalMark className="h-8 w-8 shrink-0 text-accent" />
          </NavLink>
          {collapsed ? null : (
            <span className="truncate text-[length:var(--text-body)] font-semibold leading-none">
              {t.brand.wordmark}
            </span>
          )}
        </div>

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pb-2">
          {PRIMARY.map((item) => {
            const active = section === item.id;
            return (
              <NavLink
                key={item.id}
                to={item.to}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
                className={railItemClass(active, collapsed)}
              >
                <Icon icon={item.icon} className="shrink-0" />
                {collapsed ? null : <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
          {/* 全局快搜入口：打开命令面板（任务/线程/收集箱分组结果）。 */}
          <button
            type="button"
            title={collapsed ? t.nav.searchHint : undefined}
            aria-label={t.nav.search}
            className={railItemClass(false, collapsed)}
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}
          >
            <Icon icon={Search} className="shrink-0" />
            {collapsed ? null : <span className="truncate">{t.nav.search}</span>}
          </button>
          {AI_NAV.map((item) => {
            const active = section === item.id;
            return (
              <NavLink
                key={item.id}
                to={item.to}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
                className={railItemClass(active, collapsed)}
              >
                <Icon icon={item.icon} className="shrink-0" />
                {collapsed ? null : <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div
          data-region="rail-account"
          className="mt-auto flex shrink-0 flex-col gap-1 border-t border-border pb-2 pt-1"
        >
          <button
            type="button"
            title={collapsed ? t.rail.expand : undefined}
            aria-label={collapsed ? t.rail.expand : t.rail.collapse}
            className={railItemClass(false, collapsed)}
            onClick={toggleRail}
          >
            <Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} className="shrink-0" />
            {collapsed ? null : <span className="truncate">{t.rail.collapse}</span>}
          </button>
          <NavLink
            to="/usage"
            title={collapsed ? t.rail.usage : undefined}
            aria-label={t.rail.usage}
            className={railItemClass(section === 'usage', collapsed)}
          >
            <Icon icon={ChartColumn} className="shrink-0" />
            {collapsed ? null : <span className="truncate">{t.rail.usage}</span>}
          </NavLink>
          <ThemeSwitch variant="rail" expanded={!collapsed} />
          <NavLink
            to="/settings"
            title={collapsed ? t.nav.settings : undefined}
            aria-label={t.nav.settings}
            className={railItemClass(section === 'settings', collapsed)}
          >
            <Icon icon={Settings} className="shrink-0" />
            {collapsed ? null : <span className="truncate">{t.nav.settings}</span>}
          </NavLink>
          <AccountMenu collapsed={collapsed} railWidth={railWidth} />
        </div>
      </aside>

      {paneSection ? (
        <SecondaryPane
          section={paneSection}
          width={paneWidths[paneSection]}
          onResize={(next) => {
            setPaneWidths((widths) => ({ ...widths, [paneSection]: next }));
            savePaneWidth(paneSection, next);
          }}
        />
      ) : null}

      <div data-region="canvas" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </div>
      {todos.similarOpen.length > 0 ? <SimilarOpenToast /> : null}
      <CommandPalette />
      <ActivationChecklist />
    </div>
  );
}

export const Shell: FC = bindServices(ShellContent, [
  TodosUiService,
  InboxUiService,
  ReportUiService,
]);
