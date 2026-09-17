import type { Day } from '@vital/dto';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/copy';
import { shortYmd } from './headline';
import {
  assignTimelineLanes,
  buildDaysTimeline,
  DEFAULT_TIMELINE_WIDTH_PX,
  timelineTrackMetrics,
} from './timeline';

export function DaysTimeline({
  days,
  todayYmd,
  onOpen,
}: {
  days: readonly Day[];
  todayYmd: string;
  onOpen: (day: Day) => void;
}) {
  const model = useMemo(() => buildDaysTimeline(days, todayYmd), [days, todayYmd]);
  const byId = useMemo(() => new Map(days.map((day) => [day.id, day])), [days]);
  const trackRef = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState(DEFAULT_TIMELINE_WIDTH_PX);
  const todayLabel = t.days.todayMark.replace('{date}', todayYmd.slice(5));

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidthPx(w);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [model.points.length]);

  const layout = useMemo(
    () =>
      assignTimelineLanes(
        model.points.map((point) => ({
          id: point.id,
          name: point.name,
          dateText: shortYmd(point.nextYmd, todayYmd),
          leftPercent: point.leftPercent,
        })),
        { containerWidthPx: widthPx, todayLabel },
      ),
    [model.points, todayYmd, widthPx, todayLabel],
  );
  const track = timelineTrackMetrics(layout.lanesUsed);
  const placementById = useMemo(
    () => new Map(layout.placements.map((item) => [item.id, item])),
    [layout.placements],
  );

  if (model.points.length === 0) return null;

  return (
    <section
      data-testid="days-timeline"
      className="mt-7 rounded-lg border border-border bg-surface px-6 pb-4 pt-[18px]"
    >
      <div className="flex items-baseline gap-3">
        <h2 className="text-[13px] font-semibold">{t.days.timelineTitle}</h2>
        <p className="text-[12px] text-tertiary">
          {t.days.timelineMeta
            .replace('{months}', String(model.spanMonths))
            .replace('{n}', String(model.points.length))}
        </p>
      </div>
      <div ref={trackRef} className="relative mt-2.5" style={{ height: track.height }}>
        <div className="absolute inset-x-0 h-0.5 rounded-full bg-border" style={{ top: track.axisTop }} />
        <span
          className="absolute left-0 whitespace-nowrap text-[11px] leading-[14px] font-semibold"
          style={{ top: track.labelTop(0) }}
        >
          {todayLabel}
        </span>
        <div className="absolute left-0" style={{ top: track.axisTop - 8 }}>
          <span className="block h-[18px] w-0.5 rounded-sm bg-fg" />
        </div>
        {model.months.map((tick) => (
          <span
            key={`${tick.year}-${tick.month}`}
            className={`pointer-events-none absolute text-[11px] text-tertiary ${
              tick.leftPercent < 2 ? '' : '-translate-x-1/2'
            }`}
            style={{ left: `${tick.leftPercent}%`, top: track.axisTop + 6 }}
          >
            <span className="absolute top-[-9px] left-1/2 h-[5px] w-px -translate-x-1/2 bg-border" />
            {t.days.monthLabel.replace('{n}', String(tick.month))}
          </span>
        ))}
        {model.points.map((point) => {
          const day = byId.get(point.id);
          const md = shortYmd(point.nextYmd, todayYmd);
          const placed = placementById.get(point.id);
          return (
            <span key={point.id}>
              <button
                type="button"
                onClick={() => day && onOpen(day)}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
                style={{ left: `${point.leftPercent}%`, top: track.axisTop }}
                aria-label={`${point.name} ${md}`}
              >
                <span
                  className={`mx-auto block size-[11px] rounded-full shadow-[0_0_0_2.5px_var(--bg-surface),0_1px_3px_rgb(20_34_24/25%)] ${
                    point.amber ? 'bg-due' : 'bg-accent'
                  }`}
                />
              </button>
              {placed && placed.lane !== null ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onClick={() => day && onOpen(day)}
                  className="absolute whitespace-nowrap text-[11px] leading-[14px] text-muted"
                  style={{ left: `${placed.labelLeftPercent}%`, top: track.labelTop(placed.lane) }}
                >
                  <span className="font-semibold text-fg">{point.name}</span> {md}
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
    </section>
  );
}
