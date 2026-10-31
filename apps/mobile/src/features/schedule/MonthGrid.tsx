import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { DragSurface } from './drag';
import { scheduleGestureRange, scheduleRangeHitsCell, type DayCell, type ScheduleCreateRange } from './gesture';
import { monthDayAt, type MonthMetrics } from './grid';
import { DayChip, type ScheduleActions } from './items';
import { monthCellPreview, type MonthPlacement, type ScheduleChip } from './place';

export function MonthGrid({
  model,
  today,
  timeZone,
  weekStartsOn,
  draft,
  onDraft,
  onEdit,
  onOpen,
  onOpenDay,
  onMore,
}: {
  model: MonthPlacement;
  today: string;
  timeZone: string;
  weekStartsOn: 0 | 1;
  draft: ScheduleCreateRange | null;
  onDraft: (range: ScheduleCreateRange) => void;
  onEdit: ScheduleActions['onEdit'];
  onOpen: (taskId: string) => void;
  onOpenDay: (ymd: string) => void;
  onMore: (ymd: string, chips: ScheduleChip[]) => void;
}) {
  const t = useTheme();
  const styles = createStyles(t);
  const ymds = model.cells.map((cell) => cell.ymd);
  const metrics = useRef<MonthMetrics>({ pageX: 0, pageY: 0, width: 0, height: 0, ymds });
  const gridRef = useRef<View>(null);
  const anchor = useRef<string | null>(null);
  const [live, setLive] = useState<ScheduleCreateRange[] | null>(null);
  const measure = useCallback(() => {
    gridRef.current?.measureInWindow((x, y, w, h) => {
      metrics.current = { ...metrics.current, pageX: x, pageY: y, width: w, height: h };
    });
  }, []);

  const api = useRef<ScheduleActions>({
    timeZone,
    onEdit,
    onOpen,
    onDraft,
    setLive,
    cellAt: () => null,
    dayAt: (x, y) => monthDayAt(metrics.current, x, y),
  });
  useEffect(() => {
    metrics.current.ymds = ymds;
    api.current = {
      ...api.current,
      timeZone,
      onEdit,
      onOpen,
      onDraft,
      dayAt: (x, y) => monthDayAt(metrics.current, x, y),
    };
  }, [ymds, timeZone, onEdit, onOpen, onDraft]);

  const highlights = live ?? (draft === null ? [] : [draft]);
  const weekdays = Array.from({ length: 7 }, (_, index) => copy.todos.weekday[(weekStartsOn + index) % 7]);

  return (
    <View style={styles.flex} testID="schedule-month">
      <View style={styles.weekdays}>
        {weekdays.map((label, index) => (
          <Text key={`${label}-${index}`} style={styles.weekday}>
            {label}
          </Text>
        ))}
      </View>
      <View ref={gridRef} style={styles.flex} onLayout={measure}>
        <DragSurface
          style={styles.flex}
          onGrant={(x, y) => {
            anchor.current = monthDayAt(metrics.current, x, y);
          }}
          onMove={(x, y) => {
            const from = anchor.current;
            const to = monthDayAt(metrics.current, x, y);
            if (from === null || to === null) return;
            const range = scheduleGestureRange({ kind: 'day', ymd: from }, { kind: 'day', ymd: to }, timeZone);
            setLive(range === null ? [] : [range]);
          }}
          onEnd={(x, y) => {
            setLive(null);
            const from = anchor.current;
            const to = monthDayAt(metrics.current, x, y) ?? from;
            anchor.current = null;
            if (from === null || to === null) return;
            const range = scheduleGestureRange({ kind: 'day', ymd: from }, { kind: 'day', ymd: to }, timeZone);
            if (range) onDraft(range);
          }}
        >
          {Array.from({ length: 6 }, (_, row) => (
            <View key={row} style={styles.weekRow}>
              {model.cells.slice(row * 7, row * 7 + 7).map((cell) => {
                const hit: DayCell = { kind: 'day', ymd: cell.ymd };
                const selected = highlights.some((range) => scheduleRangeHitsCell(range, hit));
                const { shown, hidden } = monthCellPreview(cell.chips);
                const isToday = cell.ymd === today;
                return (
                  <View key={cell.ymd} style={[styles.cell, selected && styles.selected]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={cell.ymd}
                      onPress={() => onOpenDay(cell.ymd)}
                      hitSlop={4}
                      testID={`schedule-day-link-${cell.ymd}`}
                    >
                      <View style={[styles.dayNum, isToday && styles.dayNumToday]}>
                        <Text
                          style={[
                            styles.dayNumText,
                            !cell.inMonth && styles.outside,
                            isToday && styles.dayNumTextToday,
                          ]}
                        >
                          {Number(cell.ymd.slice(8, 10))}
                        </Text>
                      </View>
                    </Pressable>
                    {shown.map((chip) => (
                      <DayChip key={chip.key} chip={chip} columnYmd={cell.ymd} api={api} />
                    ))}
                    {hidden.length > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={copy.schedule.more}
                        onPress={() => onMore(cell.ymd, hidden)}
                        testID={`schedule-more-${cell.ymd}`}
                      >
                        <Text style={styles.more}>{copy.schedule.more}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
        </DragSurface>
      </View>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    weekdays: { flexDirection: 'row', paddingVertical: t.space[1] },
    weekday: { flex: 1, textAlign: 'center', fontSize: 11, color: t.fgMuted },
    weekRow: { flex: 1, flexDirection: 'row' },
    cell: {
      flex: 1,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderColor: t.borderSubtle,
      padding: 2,
      overflow: 'hidden',
    },
    selected: { backgroundColor: t.bgAccentSubtle },
    dayNum: {
      alignSelf: 'flex-start',
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    dayNumToday: { backgroundColor: t.accentPrimary },
    dayNumText: { fontSize: 12, fontWeight: '600', color: t.fgPrimary, fontVariant: ['tabular-nums'] },
    dayNumTextToday: { color: t.fgOnAccent },
    outside: { color: t.fgMuted },
    more: { fontSize: 11, lineHeight: 16, color: t.accentPrimary },
  });
}
