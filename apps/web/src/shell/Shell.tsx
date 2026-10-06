import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Brain,
  CalendarDays,
  ChartColumn,
  History,
  Inbox,
  Keyboard,
  ListChecks,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  Search,
  Settings,
  Sun,
  Waypoints,
} from 'lucide-react';
import { bindServices, observer, useService } from '@rabjs/react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Suspense, useEffect, useState, type FC } from 'react';
import { flushSync } from 'react-dom';
import { t } from '@/copy';
import { HOME_PATH, TODOS_HOME_PATH } from '@/routes';
import { ActivationChecklist } from '@/features/onboarding/ActivationChecklist';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { OPEN_PALETTE_EVENT } from '@/features/palette/model';
import { AgentChatRail } from '@/features/agent-chat/AgentChatRail';
import { AgentChatService } from '@/features/agent-chat/agent-chat.service';
import { InboxUiService } from '@/features/inbox';
import { ReportUiService } from '@/features/reports/report-ui.service';
import { SimilarOpenToast } from '@/features/todos/SimilarOpenToast';
import { TaskShortcutDialogs } from '@/features/todos/TaskShortcutDialogs';
import { TodosUiService } from '@/features/todos/todos-ui.service';
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
import { ShortcutsDialog } from '@/shell/ShortcutsDialog';
import { OPEN_SHORTCUTS_EVENT } from '@/shell/shortcuts';
import { useAppShortcuts } from '@/shell/use-app-shortcuts';
import { useTodayDataReady } from '@/shell/prefetch-today';
import { RouteErrorBoundary } from '@/shell/route-error-boundary';
import { RouteLoadService } from '@/shell/route-load.service';
import { scheduleIdle, warmNeighbors, warmPath } from '@/shell/warm';
import { ThemeSwitch } from '@/shell/ThemeToggle';
import { VitalMark } from '@/shell/VitalMark';
import { RouteFallback } from '@/shell/route-fallback';
import { Icon } from '@/ui/icon';
import { Tip } from '@/ui/tip';

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

function railItemClass(active: boolean, collapsed: boolean, pending = false): string {
  return `relative mx-1 flex h-9 items-center rounded-md text-[length:var(--text-meta)] ${
    collapsed ? 'justify-center' : 'gap-2 px-3'
  } ${
    active
      ? "bg-accent-subtle text-accent before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-accent before:content-['']"
      : pending
        ? 'text-accent'
        : 'text-muted hover:bg-surface-muted hover:text-fg'
  }`;
}

type RailItem = { id: AppSection; to: string; icon: LucideIcon; label: string };

/**
 * Rail 导航项。点击时 flushSync 抢在 navigate 的 transition 启动前同步提交
 * pending 态（图标换成旋转环）——否则 rabjs 的 store 更新会被悬挂的
 * transition 纠缠，commit 时才出现。必须是 observer：pending 来自全局服务。
 */
const RailLink = observer(function RailLink({
  item,
  active,
  collapsed,
}: {
  item: RailItem;
  active: boolean;
  collapsed: boolean;
}) {
  const routeLoad = useService(RouteLoadService);
  const pending = routeLoad.pendingTo === item.to;
  return (
    <Tip label={collapsed ? item.label : undefined} side="right">
      <NavLink
        to={item.to}
        aria-label={item.label}
        className={railItemClass(active, collapsed, pending)}
        onClick={() => {
          // 已在当前栏目时不标 pending：不会触发导航，settle 不会执行
          if (!active) flushSync(() => routeLoad.markClick(item.to));
        }}
        onMouseEnter={() => warmPath(item.to)}
        onFocus={() => warmPath(item.to)}
      >
        <Icon
          icon={pending ? LoaderCircle : item.icon}
          className={pending ? 'shrink-0 animate-spin' : 'shrink-0'}
        />
        {collapsed ? null : <span className="truncate">{item.label}</span>}
      </NavLink>
    </Tip>
  );
});

function ShellContent() {
  const todos = useService(TodosUiService);
  const chat = useService(AgentChatService);
  const routeLoad = useService(RouteLoadService);
  const location = useLocation();
  useAppShortcuts();
  useEffect(() => {
    void chat.load();
  }, [chat]);
  useEffect(() => routeLoad.settle(location.pathname), [location.pathname, routeLoad]);
  const section = sectionOf(location.pathname, location.search);
  const paneSection: PaneSection | null = showsPane(section) ? (section as PaneSection) : null;
  const todayDataReady = useTodayDataReady(section === 'today');

  useEffect(() => {
    if (!todayDataReady) return;
    return scheduleIdle(() => warmNeighbors(section));
  }, [section, todayDataReady]);
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
          <Tip label={collapsed ? t.brand.wordmark : undefined} side="right">
            <NavLink
              to={HOME_PATH}
              aria-label={collapsed ? t.brand.wordmark : undefined}
              className="flex shrink-0 items-center justify-center"
            >
              <VitalMark className="h-8 w-8 shrink-0 text-accent" />
            </NavLink>
          </Tip>
          {collapsed ? null : (
            <span className="truncate text-[length:var(--text-body)] font-semibold leading-none">
              {t.brand.wordmark}
            </span>
          )}
        </div>

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pb-2">
          {PRIMARY.map((item) => (
            <RailLink
              key={item.id}
              item={item}
              active={section === item.id}
              collapsed={collapsed}
            />
          ))}
          {/* 全局快搜入口：打开命令面板（任务/线程/收集箱分组结果）。 */}
          <Tip label={collapsed ? t.nav.searchHint : undefined} side="right">
            <button
              type="button"
              aria-label={t.nav.search}
              className={railItemClass(false, collapsed)}
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}
            >
              <Icon icon={Search} className="shrink-0" />
              {collapsed ? null : <span className="truncate">{t.nav.search}</span>}
            </button>
          </Tip>
          {AI_NAV.map((item) => (
            <RailLink
              key={item.id}
              item={item}
              active={section === item.id}
              collapsed={collapsed}
            />
          ))}
        </nav>

        <div
          data-region="rail-account"
          className="mt-auto flex shrink-0 flex-col gap-1 border-t border-border pb-2 pt-1"
        >
          <Tip label={collapsed ? t.rail.expand : undefined} side="right">
            <button
              type="button"
              aria-label={collapsed ? t.rail.expand : t.rail.collapse}
              className={railItemClass(false, collapsed)}
              onClick={toggleRail}
            >
              <Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} className="shrink-0" />
              {collapsed ? null : <span className="truncate">{t.rail.collapse}</span>}
            </button>
          </Tip>
          <RailLink
            item={{ id: 'usage', to: '/usage', icon: ChartColumn, label: t.rail.usage }}
            active={section === 'usage'}
            collapsed={collapsed}
          />
          <ThemeSwitch variant="rail" expanded={!collapsed} />
          <RailLink
            item={{ id: 'settings', to: '/settings', icon: Settings, label: t.nav.settings }}
            active={section === 'settings'}
            collapsed={collapsed}
          />
          <Tip label={collapsed ? t.shortcuts.open : undefined} side="right">
            <button
              type="button"
              aria-label={t.shortcuts.open}
              className={railItemClass(false, collapsed)}
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT))}
            >
              <Icon icon={Keyboard} className="shrink-0" />
              {collapsed ? null : <span className="truncate">{t.shortcuts.open}</span>}
            </button>
          </Tip>
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
        <RouteErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </div>
      <AgentChatRail />
      {todos.similarOpen.length > 0 ? <SimilarOpenToast /> : null}
      <CommandPalette />
      <ShortcutsDialog />
      <TaskShortcutDialogs />
      <ActivationChecklist />
    </div>
  );
}

export const Shell: FC = bindServices(ShellContent, [
  TodosUiService,
  InboxUiService,
  ReportUiService,
  AgentChatService,
]);
