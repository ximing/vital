import type { Day } from '@vital/dto';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/copy';
import {
  assignTimelineLanes,
  buildDaysTimeline,
  clipVerticalLine,
  DEFAULT_TIMELINE_WIDTH_PX,
  timelineTrackMetrics,
  timelineYmd,
} from './timeline';

/** Label text line height; leader lines start just below it. */
const LABEL_LINE_PX = 14;
/** Leader line stops this far above the dot center. */
const LEADER_DOT_GAP_PX = 9;

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
          dateText: timelineYmd(point.nextYmd, todayYmd),
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

  // Leader line segments for labels lifted above lane 0, clipped so a line
  // never crosses another label's text on its way down to the dot.
  const leaders = useMemo(() => {
    const boxes = layout.placements
      .filter((item) => item.lane !== null)
      .map((item) => ({
        id: item.id,
        lane: item.lane as number,
        leftPx: (item.labelLeftPercent / 100) * widthPx,
        rightPx: ((item.labelLeftPercent + item.widthPercent) / 100) * widthPx,
      }));
    const byPoint = new Map<string, { top: number; height: number }[]>();
    for (const point of model.points) {
      const placed = placementById.get(point.id);
      if (!placed || placed.lane === null || placed.lane < 1) continue;
      const dotXPx = (point.leftPercent / 100) * widthPx;
      const covers = boxes
        .filter(
          (box) =>
            box.id !== point.id &&
            box.lane < (placed.lane as number) &&
            dotXPx >= box.leftPx - 2 &&
            dotXPx <= box.rightPx + 2,
        )
        .map((box) => ({
          top: track.labelTop(box.lane) - 1,
          bottom: track.labelTop(box.lane) + LABEL_LINE_PX + 1,
        }));
      byPoint.set(
        point.id,
        clipVerticalLine(
          track.labelTop(placed.lane) + LABEL_LINE_PX + 1,
          track.axisTop - LEADER_DOT_GAP_PX,
          covers,
        ),
      );
    }
    return byPoint;
    // track is derived from layout; placementById from layout.placements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, model.points, widthPx]);

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
        {model.points.map((point) =>
          (leaders.get(point.id) ?? []).map((seg, i) => (
            <span
              key={`${point.id}-leader-${i}`}
              aria-hidden
              className="pointer-events-none absolute w-px bg-border"
              style={{ left: `${point.leftPercent}%`, top: seg.top, height: seg.height }}
            />
          )),
        )}
        {model.points.map((point) => {
          const day = byId.get(point.id);
          const md = timelineYmd(point.nextYmd, todayYmd);
          const placed = placementById.get(point.id);
          return (
            <span key={point.id}>
              <button
                type="button"
                onClick={() => day && onOpen(day)}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
                style={{ left: `${point.leftPercent}%`, top: track.axisTop }}
                aria-label={`${point.name} ${point.nextYmd}`}
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
