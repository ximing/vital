import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { DragSurface } from './drag';
import {
  QUARTER_MINUTES,
  scheduleGestureRange,
  scheduleRangeHitsCell,
  type DayCell,
  type HourCell,
  type ScheduleCreateRange,
  type SlotMinute,
} from './gesture';
import { bandDayAt, GRID_HEIGHT, HOUR_GUTTER, hourCellAt, QUARTER_H, type Viewport } from './grid';
import { DayChip, PointChip, quarterMinute, TimedBlock, TimedDraftBlock, type ScheduleActions } from './items';
import type { WeekPlacement } from './place';
import { scheduleNowMinute, scheduleScrollHour } from './place';
import type { ScheduleTimeEdit } from './schedule.service';

export function WeekGrid({
  model,
  today,
  timeZone,
  now,
  draft,
  onDraft,
  onEdit,
  onOpen,
  onOpenDay,
}: {
  model: WeekPlacement;
  today: string;
  timeZone: string;
  now: Date;
  draft: ScheduleCreateRange | null;
  onDraft: (range: ScheduleCreateRange) => void;
  onEdit: (edit: ScheduleTimeEdit) => void;
  onOpen: (taskId: string) => void;
  onOpenDay: (ymd: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const days = model.days.map((day) => day.ymd);
  const daysRef = useRef(days);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const viewport = useRef<Viewport>({ pageX: 0, pageY: 0, width: 0, height: 0 });
  const band = useRef({ pageX: 0, pageY: 0, width: 0, height: 0, days });
  const portRef = useRef<View>(null);
  const bandRef = useRef<View>(null);
  const [width, setWidth] = useState(0);
  const [live, setLive] = useState<ScheduleCreateRange[] | null>(null);
  const anchorDay = useRef<string | null>(null);
  const alignedYmd = useRef<string | null>(null);

  const measurePort = useCallback(() => {
    portRef.current?.measureInWindow((x, y, w, h) => {
      viewport.current = { pageX: x, pageY: y, width: w, height: h };
      setWidth((prev) => (prev === w ? prev : w));
    });
  }, []);
  const measureBand = useCallback(() => {
    bandRef.current?.measureInWindow((x, y, w, h) => {
      band.current = { ...band.current, pageX: x, pageY: y, width: w, height: h };
    });
  }, []);

  const scrollToNow = useCallback(() => {
    scrollRef.current?.scrollTo({
      y: scheduleScrollHour(timeZone) * 4 * QUARTER_H,
      animated: false,
    });
    alignedYmd.current = model.startYmd;
  }, [model.startYmd, timeZone]);
  useEffect(() => {
    alignedYmd.current = null;
    const id = requestAnimationFrame(scrollToNow);
    return () => cancelAnimationFrame(id);
  }, [scrollToNow]);

  const api = useRef<ScheduleActions>({
    timeZone,
    onEdit,
    onOpen,
    onDraft,
    setLive,
    cellAt: (x, y) => hourCellAt(viewport.current, scrollY.current, daysRef.current, x, y),
    dayAt: (x, y) => bandDayAt(band.current, x, y),
  });
  useEffect(() => {
    daysRef.current = days;
    band.current.days = days;
    api.current = {
      ...api.current,
      timeZone,
      onEdit,
      onOpen,
      onDraft,
      cellAt: (x, y) => hourCellAt(viewport.current, scrollY.current, daysRef.current, x, y),
      dayAt: (x, y) => bandDayAt(band.current, x, y),
    };
  }, [days, timeZone, onEdit, onOpen, onDraft]);

  const highlights = live ?? (draft === null ? [] : [draft]);
  const timedDraft = draft?.kind === 'timed' ? draft : null;
  const colW = width > HOUR_GUTTER ? (width - HOUR_GUTTER) / model.days.length : 0;
  const hours = model.days[0]?.hours ?? [];
  const nowMinute = scheduleNowMinute(timeZone, now);

  return (
    <View style={styles.flex} testID={model.view === 'day' ? 'schedule-day' : 'schedule-week'}>
      <View style={styles.headRow}>
        <View style={styles.gutter} />
        {model.days.map((day) => {
          const weekend = day.weekday === 0 || day.weekday === 6;
          const isToday = day.ymd === today;
          return (
            <Pressable
              key={day.ymd}
              accessibilityRole="button"
              accessibilityLabel={day.ymd}
              onPress={() => onOpenDay(day.ymd)}
              style={styles.headDay}
              testID={`schedule-day-link-${day.ymd}`}
            >
              <Text style={[styles.weekday, weekend && styles.muted]}>{copy.todos.weekday[day.weekday]}</Text>
              <View style={[styles.dayNum, isToday && styles.dayNumToday]}>
                <Text style={[styles.dayNumText, isToday && styles.dayNumTextToday]}>
                  {Number(day.ymd.slice(8, 10))}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View ref={bandRef} onLayout={measureBand}>
        <DragSurface
          style={styles.band}
          onGrant={(x, y) => {
            anchorDay.current = bandDayAt(band.current, x, y);
          }}
          onMove={(x, y) => {
            const from = anchorDay.current;
            const to = bandDayAt(band.current, x, y);
            if (from === null || to === null) return;
            const range = scheduleGestureRange({ kind: 'day', ymd: from }, { kind: 'day', ymd: to }, timeZone);
            setLive(range === null ? [] : [range]);
          }}
          onEnd={(x, y, moved) => {
            setLive(null);
            const from = anchorDay.current;
            const to = bandDayAt(band.current, x, y) ?? from;
            anchorDay.current = null;
            if (from === null || to === null) return;
            if (!moved && to === from) {
              const range = scheduleGestureRange({ kind: 'day', ymd: from }, { kind: 'day', ymd: from }, timeZone);
              if (range) onDraft(range);
              return;
            }
            const range = scheduleGestureRange({ kind: 'day', ymd: from }, { kind: 'day', ymd: to }, timeZone);
            if (range) onDraft(range);
          }}
        >
          <View style={styles.gutter}>
            <Text style={styles.gutterText}>{copy.schedule.allDay}</Text>
          </View>
          {model.days.map((day) => {
            const cell: DayCell = { kind: 'day', ymd: day.ymd };
            const selected = highlights.some((range) => scheduleRangeHitsCell(range, cell));
            return (
              <View
                key={day.ymd}
                style={[styles.bandCell, selected && styles.selected]}
                testID={`schedule-all-day-${day.ymd}`}
              >
                {day.allDay.map((chip) => (
                  <DayChip key={chip.key} chip={chip} columnYmd={day.ymd} api={api} />
                ))}
              </View>
            );
          })}
        </DragSurface>
      </View>
      <View ref={portRef} style={styles.flex} onLayout={measurePort}>
        <ScrollView
          ref={scrollRef}
          testID="schedule-hours"
          scrollEventThrottle={16}
          onContentSizeChange={() => {
            if (alignedYmd.current === model.startYmd) return;
            scrollToNow();
          }}
          onScroll={(event) => {
            scrollY.current = event.nativeEvent.contentOffset.y;
          }}
        >
          <View style={{ height: GRID_HEIGHT }}>
            {hours.flatMap((slot) =>
              QUARTER_MINUTES.map((minute) => (
                <QuarterRow
                  key={`${slot.hour}-${minute}`}
                  days={model.days}
                  hour={slot.hour}
                  minute={minute}
                  highlights={highlights}
                  styles={styles}
                  api={api}
                  onDraft={onDraft}
                  timeZone={timeZone}
                />
              )),
            )}
            {colW > 0 ? (
              <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                {model.days.map((day, index) => (
                  <View
                    key={day.ymd}
                    pointerEvents="box-none"
                    style={{
                      position: 'absolute',
                      left: HOUR_GUTTER + index * colW,
                      width: colW,
                      top: 0,
                      height: GRID_HEIGHT,
                      overflow: 'hidden',
                    }}
                  >
                    {day.blocks.map((block) => (
                      <TimedBlock
                        key={block.key}
                        block={block}
                        columnYmd={day.ymd}
                        api={api}
                        laneStyle={{
                          left: (block.lane / block.laneCount) * colW + 1,
                          width: Math.max(colW / block.laneCount - 2, 4),
                        }}
                      />
                    ))}
                    {timedDraft?.ymd === day.ymd ? <TimedDraftBlock draft={timedDraft} api={api} /> : null}
                    {day.ymd === today ? (
                      <View
                        pointerEvents="none"
                        testID="schedule-now"
                        style={[styles.now, { top: (nowMinute / 1440) * GRID_HEIGHT }]}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function QuarterRow({
  days,
  hour,
  minute,
  highlights,
  styles,
  api,
  onDraft,
  timeZone,
}: {
  days: WeekPlacement['days'];
  hour: number;
  minute: SlotMinute;
  highlights: readonly ScheduleCreateRange[];
  styles: ReturnType<typeof createStyles>;
  api: RefObject<ScheduleActions>;
  onDraft: (range: ScheduleCreateRange) => void;
  timeZone: string;
}) {
  return (
    <View style={[styles.row, minute === 45 && styles.rowHour]}>
      <View style={styles.gutter}>
        {minute === 0 ? (
          <Text style={styles.gutterText}>
            {String(hour).padStart(2, '0')}:00
          </Text>
        ) : null}
      </View>
      {days.map((day) => {
        const cell: HourCell = { kind: 'hour', ymd: day.ymd, hour, minute };
        const selected = highlights.some((range) => scheduleRangeHitsCell(range, cell));
        const chips = (day.hours[hour]?.items ?? []).filter((chip) => quarterMinute(chip.timeLabel) === minute);
        return (
          <Pressable
            key={day.ymd}
            accessibilityRole="button"
            accessibilityLabel={`${day.ymd} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`}
            onPress={() => {
              const range = scheduleGestureRange(cell, cell, timeZone);
              if (range) onDraft(range);
            }}
            style={[styles.slot, selected && styles.selected]}
            testID={`schedule-slot-${day.ymd}-${hour}-${minute}`}
          >
            {chips.map((chip) => (
              <PointChip key={chip.key} chip={chip} api={api} />
            ))}
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    headRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.borderSubtle },
    headDay: { flex: 1, alignItems: 'center', paddingVertical: t.space[1], gap: 2 },
    weekday: { fontSize: 11, color: t.fgMuted },
    muted: { color: t.fgMuted },
    dayNum: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayNumToday: { backgroundColor: t.accentPrimary },
    dayNumText: { fontSize: 14, fontWeight: '600', color: t.fgPrimary, fontVariant: ['tabular-nums'] },
    dayNumTextToday: { color: t.fgOnAccent },
    gutter: { width: HOUR_GUTTER, paddingTop: 2, paddingLeft: t.space[1] },
    gutterText: { fontSize: 10, color: t.fgMuted, fontVariant: ['tabular-nums'] },
    band: {
      flexDirection: 'row',
      minHeight: 36,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borderSubtle,
    },
    bandCell: {
      flex: 1,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: t.borderSubtle,
      paddingHorizontal: 2,
      paddingVertical: 2,
      gap: 2,
    },
    row: {
      height: QUARTER_H,
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borderSubtle,
    },
    rowHour: { borderBottomColor: t.borderSubtle },
    slot: {
      flex: 1,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: t.borderSubtle,
      paddingHorizontal: 1,
    },
    selected: { backgroundColor: t.bgAccentSubtle },
    now: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: t.accentPrimary,
      zIndex: 2,
    },
  });
}
