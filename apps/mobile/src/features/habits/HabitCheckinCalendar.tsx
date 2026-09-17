import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { Habit, HabitCheckinDay } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { monthGrid, ymdParts } from '../../lib/calendar-grid';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { Icon } from '../../ui/icon';

function dayLabel(ymd: string, done: number, total: number, state: 'done' | 'missed' | 'empty'): string {
  const m = String(Number(ymd.slice(5, 7)));
  const d = String(Number(ymd.slice(8)));
  if (state === 'done') {
    return copy.habits.checkinDone
      .replace('{m}', m)
      .replace('{d}', d)
      .replace('{done}', String(done))
      .replace('{total}', String(total));
  }
  if (state === 'missed') {
    return copy.habits.checkinMissed.replace('{m}', m).replace('{d}', d);
  }
  return copy.habits.checkinEmpty.replace('{m}', m).replace('{d}', d);
}

export function HabitMonthNav({
  monthCursor,
  today,
  onShift,
}: {
  monthCursor: string;
  today: string;
  onShift: (delta: number) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const { y, m } = ymdParts(monthCursor);
  const thisMonth = `${today.slice(0, 7)}-01`;
  const canNext = monthCursor < thisMonth;
  return (
    <View style={styles.nav}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.habits.calendarPrev}
        onPress={() => onShift(-1)}
        hitSlop={8}
        style={styles.navBtn}
      >
        <Icon icon={ChevronLeft} size={18} color={t.fgMuted} />
      </Pressable>
      <Text style={styles.navLabel}>
        {copy.habits.calendarMonth.replace('{y}', String(y)).replace('{m}', String(m))}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.habits.calendarNext}
        disabled={!canNext}
        onPress={() => {
          if (canNext) onShift(1);
        }}
        hitSlop={8}
        style={[styles.navBtn, !canNext && styles.navDisabled]}
      >
        <Icon icon={ChevronRight} size={18} color={t.fgMuted} />
      </Pressable>
    </View>
  );
}

export function HabitCheckinCalendar({
  habit,
  days,
  monthCursor,
  weekStartsOn,
  today,
  createdOn,
}: {
  habit: Habit;
  days: HabitCheckinDay[];
  monthCursor: string;
  weekStartsOn: 0 | 1;
  today: string;
  createdOn: string;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const { y, m } = ymdParts(monthCursor);
  const cells = monthGrid(y, m, weekStartsOn);
  const weekday = copy.todos.weekday;
  const labels =
    weekStartsOn === 1
      ? [weekday[1], weekday[2], weekday[3], weekday[4], weekday[5], weekday[6], weekday[0]]
      : weekday;
  const doneByDate = new Map(days.map((row) => [row.date, row.done]));
  const total =
    habit.kind === 'count' && habit.targetCount !== null && habit.targetCount > 0
      ? habit.targetCount
      : 1;

  return (
    <View
      accessible
      accessibilityLabel={copy.habits.calendarAria.replace('{name}', habit.name)}
      style={styles.cal}
    >
      <View style={styles.grid}>
        {labels.map((label) => (
          <Text key={label} style={styles.dow}>
            {label}
          </Text>
        ))}
        {cells.map((ymd, index) => {
          if (ymd === null) return <View key={`e-${String(index)}`} style={styles.day} />;
          const done = doneByDate.get(ymd) ?? 0;
          const isToday = ymd === today;
          const future = ymd > today;
          const beforeStart = ymd < createdOn;
          const complete = done > 0 && done >= total;
          const partial = done > 0 && done < total;
          const missed = !future && !beforeStart && done === 0 && ymd !== today;
          const state: 'done' | 'missed' | 'empty' = complete || partial ? 'done' : missed ? 'missed' : 'empty';
          return (
            <View
              key={ymd}
              accessibilityLabel={dayLabel(ymd, done, total, state)}
              style={styles.day}
            >
              <View
                style={[
                  styles.dayInner,
                  complete && { backgroundColor: t.statusDone },
                  partial && { backgroundColor: t.bgAccentSubtle },
                  isToday && !complete && styles.dayToday,
                ]}
              >
                <Text
                  style={[
                    styles.dayNum,
                    complete && { color: t.fgOnAccent, fontWeight: '600' },
                    partial && { color: t.accentPrimary, fontWeight: '600' },
                    (future || beforeStart) && { color: t.fgMuted, opacity: 0.4 },
                    missed && { color: t.fgMuted },
                  ]}
                >
                  {Number(ymd.slice(8))}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    nav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.space[2],
      paddingVertical: t.space[2],
    },
    navBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navDisabled: { opacity: 0.3 },
    navLabel: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.fgPrimary },
    cal: { marginTop: t.space[2] },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    dow: {
      width: '14.28%',
      textAlign: 'center',
      fontSize: 10,
      lineHeight: 16,
      color: t.fgMuted,
      marginBottom: 2,
    },
    day: { width: '14.28%', alignItems: 'center', paddingVertical: 1 },
    dayInner: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayToday: {
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: t.accentPrimary,
    },
    dayNum: { fontSize: 11, fontVariant: ['tabular-nums'], color: t.fgPrimary },
  });
