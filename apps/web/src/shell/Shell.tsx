import type { LucideIcon } from 'lucide-react';
import { BookOpen, Calendar, CheckSquare, Search } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { ActivationChecklist } from '@/features/onboarding';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { AccountMenu } from '@/shell/AccountMenu';
import { loadPaneWidth, RAIL_WIDTH, savePaneWidth, type PaneSection } from '@/shell/chrome';
import { SecondaryPane } from '@/shell/SecondaryPane';
import { sectionOf, showsPane, type AppSection } from '@/shell/section';
import { VitalMark } from '@/shell/VitalMark';
import { Icon } from '@/ui/icon';
import { useState } from 'react';

const PRIMARY: { id: AppSection; to: string; icon: LucideIcon; label: string }[] = [
  { id: 'todos', to: HOME_PATH, icon: CheckSquare, label: t.rail.todos },
  { id: 'capture', to: '/inbox', icon: BookOpen, label: t.rail.capture },
  { id: 'reflect', to: '/reports', icon: Calendar, label: t.rail.reflect },
];

export function Shell() {
  const location = useLocation();
  const section = sectionOf(location.pathname, location.search);
  const paneSection: PaneSection | null = showsPane(section) ? (section as PaneSection) : null;
  const onSearch = section === 'search';
  const [paneWidths, setPaneWidths] = useState<Record<PaneSection, number>>(() => ({
    todos: loadPaneWidth('todos'),
    capture: loadPaneWidth('capture'),
    reflect: loadPaneWidth('reflect'),
  }));

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

        <div className="px-1 pb-1">
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
        <AccountMenu collapsed railWidth={RAIL_WIDTH} />
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

      <div data-region="canvas" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <Outlet />
      </div>
      <CommandPalette />
      <ActivationChecklist />
    </div>
  );
}
