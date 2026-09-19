import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import {
  decadeStart,
  monthGrid,
  padYmd,
  shiftCalendarCursor,
  yearPanelYears,
  ymdParts,
  type CalendarView,
} from '../lib/calendar-grid';
import { copy } from '../lib/copy';
import { useTheme } from '../theme/use-theme';
import { Icon } from '../ui/icon';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function stepLabels(view: CalendarView): {
  innerPrev: string;
  innerNext: string;
  superPrev: string;
  superNext: string;
} {
  if (view === 'year') {
    return {
      innerPrev: copy.calendar.prevDecade,
      innerNext: copy.calendar.nextDecade,
      superPrev: copy.calendar.prevCentury,
      superNext: copy.calendar.nextCentury,
    };
  }
  if (view === 'month') {
    return {
      innerPrev: copy.calendar.prevYear,
      innerNext: copy.calendar.nextYear,
      superPrev: copy.calendar.prevDecade,
      superNext: copy.calendar.nextDecade,
    };
  }
  return {
    innerPrev: copy.calendar.prevMonth,
    innerNext: copy.calendar.nextMonth,
    superPrev: copy.calendar.prevYear,
    superNext: copy.calendar.nextYear,
  };
}

export function CalendarPanel({
  selectedYmd,
  today,
  weekStartsOn,
  onPickDay,
}: {
  selectedYmd: string;
  today: string;
  weekStartsOn: 0 | 1;
  onPickDay: (ymd: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [view, setView] = useState<CalendarView>('date');
  const [monthCursor, setMonthCursor] = useState(() => `${(selectedYmd || today).slice(0, 7)}-01`);
  const { y, m } = ymdParts(monthCursor);
  const selected = selectedYmd === '' ? null : ymdParts(selectedYmd);
  const todayParts = ymdParts(today);
  const labels = stepLabels(view);
  const decade = decadeStart(y);
  const weekday = copy.todos.weekday;
  const dow =
    weekStartsOn === 1
      ? [weekday[1], weekday[2], weekday[3], weekday[4], weekday[5], weekday[6], weekday[0]]
      : weekday;
  const days = monthGrid(y, m, weekStartsOn);
  const years = yearPanelYears(y);

  function shift(step: 'inner' | 'super', dir: -1 | 1) {
    setMonthCursor(shiftCalendarCursor(monthCursor, view, step, dir));
  }

  function pickYear(year: number) {
    setMonthCursor(padYmd(year, m, 1));
    setView('month');
  }

  function pickMonth(month: number) {
    setMonthCursor(padYmd(y, month, 1));
    setView('date');
  }

  return (
    <View>
      <View style={styles.monthNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.superPrev}
          onPress={() => shift('super', -1)}
          hitSlop={8}
        >
          <Icon icon={ChevronsLeft} size={18} color={t.fgMuted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.innerPrev}
          onPress={() => shift('inner', -1)}
          hitSlop={8}
        >
          <Icon icon={ChevronLeft} size={18} color={t.fgMuted} />
        </Pressable>
        <View style={styles.headerLabels}>
          {view === 'year' ? (
            <Text style={styles.monthLabel}>
              {copy.calendar.decade.replace('{from}', String(decade)).replace('{to}', String(decade + 9))}
            </Text>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.calendar.selectYear}
                onPress={() => setView('year')}
                hitSlop={4}
              >
                <Text style={styles.monthLabel}>{copy.calendar.year.replace('{y}', String(y))}</Text>
              </Pressable>
              {view === 'date' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.calendar.selectMonth}
                  onPress={() => setView('month')}
                  hitSlop={4}
                >
                  <Text style={styles.monthLabel}>{copy.calendar.month.replace('{m}', String(m))}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.innerNext}
          onPress={() => shift('inner', 1)}
          hitSlop={8}
        >
          <Icon icon={ChevronRight} size={18} color={t.fgMuted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.superNext}
          onPress={() => shift('super', 1)}
          hitSlop={8}
        >
          <Icon icon={ChevronsRight} size={18} color={t.fgMuted} />
        </Pressable>
      </View>

      {view === 'date' ? (
        <View style={styles.grid}>
          {dow.map((item) => (
            <Text key={item} style={styles.dow}>
              {item}
            </Text>
          ))}
          {days.map((ymd, i) => {
            if (ymd === null) return <View key={`e-${i}`} style={styles.day} />;
            const isToday = ymd === today;
            const isSel = ymd === selectedYmd;
            return (
              <Pressable
                key={ymd}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel }}
                onPress={() => onPickDay(ymd)}
                style={styles.day}
              >
                <View style={[styles.dayInner, isSel && styles.daySel, isToday && !isSel && styles.dayToday]}>
                  <Text style={[styles.dayNum, isSel && styles.dayNumOn, isToday && !isSel && styles.dayTodayNum]}>
                    {Number(ymd.slice(8))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {view === 'month' ? (
        <View style={styles.grid}>
          {MONTHS.map((month) => {
            const isSel = selected !== null && selected.y === y && selected.m === month;
            const isCurrent = todayParts.y === y && todayParts.m === month;
            return (
              <Pressable
                key={month}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel }}
                onPress={() => pickMonth(month)}
                style={styles.period}
              >
                <View style={[styles.periodInner, isSel && styles.daySel, isCurrent && !isSel && styles.dayToday]}>
                  <Text style={[styles.periodLabel, isSel && styles.dayNumOn, isCurrent && !isSel && styles.dayTodayNum]}>
                    {copy.calendar.month.replace('{m}', String(month))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {view === 'year' ? (
        <View style={styles.grid}>
          {years.map((year) => {
            const inDecade = year >= decade && year <= decade + 9;
            const isSel = selected !== null && selected.y === year;
            const isCurrent = todayParts.y === year;
            return (
              <Pressable
                key={year}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel }}
                onPress={() => pickYear(year)}
                style={styles.period}
              >
                <View style={[styles.periodInner, isSel && styles.daySel, isCurrent && !isSel && styles.dayToday]}>
                  <Text
                    style={[
                      styles.periodLabel,
                      isSel && styles.dayNumOn,
                      isCurrent && !isSel && styles.dayTodayNum,
                      !inDecade && !isSel && !isCurrent && styles.muted,
                    ]}
                  >
                    {copy.calendar.year.replace('{y}', String(year))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    monthNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: t.space[3],
      gap: t.space[1],
    },
    headerLabels: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space[1],
    },
    monthLabel: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.fgPrimary },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    dow: {
      width: '14.28%',
      textAlign: 'center',
      fontSize: t.type.caption.fontSize,
      color: t.fgMuted,
      marginBottom: t.space[1],
    },
    day: { width: '14.28%', alignItems: 'center', paddingVertical: 2 },
    dayInner: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    daySel: { backgroundColor: t.accentPrimary },
    dayToday: { borderWidth: 1, borderColor: t.accentPrimary },
    dayNum: { fontSize: t.type.caption.fontSize, color: t.fgPrimary },
    dayNumOn: { color: t.fgOnAccent, fontWeight: '600' },
    dayTodayNum: { color: t.accentPrimary, fontWeight: '600' },
    period: { width: '33.33%', alignItems: 'center', paddingVertical: 4 },
    periodInner: {
      minWidth: 72,
      height: 36,
      borderRadius: t.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: t.space[2],
    },
    periodLabel: { fontSize: t.type.meta.fontSize, color: t.fgPrimary, fontWeight: '500' },
    muted: { color: t.fgMuted },
  });
