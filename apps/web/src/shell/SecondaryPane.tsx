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
import { UserListsNav } from '@/features/todos';
import { CapturePane } from '@/shell/CapturePane';
import { railNavClass } from '@/shell/rail-nav';
import {
  listIdFrom,
  reportTypeOf,
  rhythmHref,
  RHYTHM_LIST_IDS,
  type AppSection,
} from '@/shell/section';
import { clampPaneWidth } from '@/shell/chrome';
import { Icon } from '@/ui/icon';

const RHYTHM_ITEMS: { id: (typeof RHYTHM_LIST_IDS)[number]; icon: typeof Sun; label: string }[] = [
  { id: 'smart:today', icon: Sun, label: t.lists.today },
  { id: 'smart:upcoming', icon: CalendarClock, label: t.lists.upcoming },
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
  section: AppSection;
  width: number;
  onResize: (width: number) => void;
}) {
  const location = useLocation();
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const title =
    section === 'rhythm'
      ? t.rail.rhythm
      : section === 'capture'
        ? t.rail.capture
        : section === 'lists'
          ? t.rail.lists
          : t.rail.reflect;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startW: width };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    onResize(clampPaneWidth(drag.current.startW + event.clientX - drag.current.startX));
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
      className="relative flex h-full shrink-0 flex-col bg-surface"
      style={{ width }}
      aria-label={title}
    >
      <div className="shrink-0 px-4 pb-2 pt-5">
        <h2 className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
          {title}
        </h2>
      </div>
      {section === 'capture' ? (
        <CapturePane />
      ) : (
        <nav className="min-h-0 flex-1 overflow-y-auto pb-6">
          {section === 'rhythm' ? (
            <RhythmNav pathname={location.pathname} search={location.search} />
          ) : null}
          {section === 'lists' ? <ListsNavPane /> : null}
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

function RhythmNav({ pathname, search }: { pathname: string; search: string }) {
  const current = listIdFrom(pathname, search) ?? 'smart:today';
  return (
    <>
      {RHYTHM_ITEMS.map((item) => (
        <NavLink
          key={item.id}
          to={rhythmHref(item.id, pathname)}
          className={railNavClass(current === item.id)}
        >
          <Icon icon={item.icon} className="shrink-0 opacity-80" />
          <span className="truncate">{item.label}</span>
        </NavLink>
      ))}
    </>
  );
}

function ListsNavPane() {
  return (
    <>
      <NavLink to="/todos/lists/smart:inbox" className={({ isActive }) => railNavClass(isActive)}>
        <Icon icon={Inbox} className="shrink-0 opacity-80" />
        <span className="truncate">{t.lists.inbox}</span>
      </NavLink>
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
