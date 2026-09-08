import {
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
  Sun,
} from 'lucide-react';
import { useRef, type PointerEvent } from 'react';
import { NavLink, useLocation } from 'react-router';
import { t } from '@/copy';
import { REPORT_TYPES } from '@/features/reports/model';
import { ListShortcuts, UserListsNav } from '@/features/todos';
import { useCountsQuery } from '@/features/todos/queries';
import { CapturePane } from '@/shell/CapturePane';
import { railNavClass } from '@/shell/rail-nav';
import {
  listIdFrom,
  reportTypeOf,
  rhythmHref,
} from '@/shell/section';
import { clampPaneWidth, type PaneSection } from '@/shell/chrome';
import { Icon } from '@/ui/icon';

const SMART_ITEMS: { id: string; icon: typeof Sun; label: string }[] = [
  { id: 'smart:today', icon: Sun, label: t.lists.today },
  { id: 'smart:upcoming', icon: CalendarClock, label: t.lists.upcoming },
  { id: 'smart:inbox', icon: Inbox, label: t.lists.inbox },
  { id: 'smart:anytime', icon: InfinityIcon, label: t.lists.anytime },
  { id: 'smart:someday', icon: Cloud, label: t.lists.someday },
  { id: 'smart:done', icon: CircleCheck, label: t.lists.done },
];

const REPORT_ICONS = {
  daily: Calendar,
  weekly: CalendarRange,
  monthly: CalendarDays,
  yearly: CalendarFold,
} as const;

export function SecondaryPane({
  section,
  width,
  onResize,
}: {
  section: PaneSection;
  width: number;
  onResize: (width: number) => void;
}) {
  const location = useLocation();
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const title =
    section === 'todos' ? t.rail.todos : section === 'capture' ? t.rail.capture : t.rail.reflect;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startW: width };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    onResize(clampPaneWidth(drag.current.startW + event.clientX - drag.current.startX, section));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <aside
      data-region="library"
      className="relative flex h-full min-h-0 shrink-0 flex-col self-stretch bg-surface"
      style={{ width }}
      aria-label={title}
    >
      {section === 'todos' ? (
        <div className="shrink-0 pt-3" />
      ) : (
        <div className="shrink-0 px-3 pb-1 pt-4">
          <h2 className="px-1 text-[length:var(--text-caption)] font-medium uppercase tracking-[0.08em] text-muted">
            {title}
          </h2>
        </div>
      )}
      {section === 'capture' ? (
        <CapturePane />
      ) : (
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
          {section === 'todos' ? (
            <TodosNav pathname={location.pathname} search={location.search} />
          ) : null}
          {section === 'reflect' ? <ReflectNav search={location.search} /> : null}
        </nav>
      )}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t.rail.resize}
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize hover:bg-accent focus-visible:bg-accent"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </aside>
  );
}

function TodosNav({ pathname, search }: { pathname: string; search: string }) {
  const current = listIdFrom(pathname, search) ?? 'smart:today';
  const counts = useCountsQuery().data ?? {};
  return (
    <>
      <ListShortcuts />
      {SMART_ITEMS.map((item) => {
        const count = counts[item.id];
        return (
          <NavLink
            key={item.id}
            to={rhythmHref(item.id, pathname)}
            className={railNavClass(current === item.id)}
          >
            <Icon icon={item.icon} className="shrink-0 opacity-80" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {count ? (
              <span className="ml-auto shrink-0 pl-2 text-[length:var(--text-caption)] tabular-nums text-tertiary">
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
          </NavLink>
        );
      })}
      <div className="mx-3 my-3 h-px bg-border/80" />
      <p className="px-3 pb-1.5 pt-0.5 text-[length:var(--text-caption)] text-muted">{t.rail.lists}</p>
      <UserListsNav icon={Folder} addIcon={Plus} />
    </>
  );
}

function ReflectNav({ search }: { search: string }) {
  const current = reportTypeOf(search);
  return (
    <>
      {REPORT_TYPES.map((type) => (
        <NavLink
          key={type}
          to={type === 'daily' ? '/reports' : `/reports?type=${type}`}
          className={railNavClass(current === type)}
        >
          <Icon icon={REPORT_ICONS[type]} className="shrink-0 opacity-80" />
          <span className="truncate">{t.reports[type]}</span>
        </NavLink>
      ))}
    </>
  );
}
