import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { addMonthsYmd, monthGrid, ymdParts } from '../lib/calendar-grid';
import { copy } from '../lib/copy';
import { formatHumanDay, localDateStamp } from '../lib/format';
import { useTheme } from '../theme/use-theme';
import { Icon } from '../ui/icon';
import { PickerSheet } from './PickerSheet';
import { TimePicker } from './TimeField';

export function DateField({
  label,
  value,
  kind,
  zone,
  weekStartsOn = 1,
  onChange,
}: {
  label: string;
  value: string;
  kind: 'date' | 'datetime-local';
  zone: string;
  weekStartsOn?: 0 | 1;
  onChange: (next: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const today = localDateStamp(zone);
  const selectedYmd = value === '' ? '' : value.slice(0, 10);
  const selectedTime = value.includes('T') ? value.slice(11, 16) : '09:00';
  const [open, setOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState((selectedYmd || today).slice(0, 7) + '-01');
  const { y, m } = ymdParts(monthCursor);
  const cells = monthGrid(y, m, weekStartsOn);
  const weekday = copy.todos.weekday;
  const labels =
    weekStartsOn === 1
      ? [weekday[1], weekday[2], weekday[3], weekday[4], weekday[5], weekday[6], weekday[0]]
      : weekday;

  const summary =
    selectedYmd === ''
      ? copy.todos.addDate
      : kind === 'date'
        ? formatHumanDay(selectedYmd, zone)
        : `${formatHumanDay(selectedYmd, zone)} ${selectedTime}`;

  function pickDay(ymd: string) {
    if (kind === 'date') {
      onChange(ymd);
      setOpen(false);
    } else {
      onChange(`${ymd}T${selectedTime || '09:00'}`);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            setMonthCursor((selectedYmd || today).slice(0, 7) + '-01');
            setOpen(true);
          }}
          style={styles.trigger}
        >
          <Text style={[styles.value, selectedYmd === '' && styles.placeholder]} numberOfLines={1}>
            {summary}
          </Text>
        </Pressable>
        {selectedYmd !== '' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.todos.clearDate}
            onPress={() => onChange('')}
            style={styles.clear}
          >
            <Text style={styles.clearLabel}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <PickerSheet visible={open} title={label} onClose={() => setOpen(false)}>
        <View style={styles.monthNav}>
          <Pressable
            accessibilityLabel={copy.todos.views.week}
            onPress={() => setMonthCursor(addMonthsYmd(monthCursor, -1))}
            hitSlop={8}
          >
            <Icon icon={ChevronLeft} size={18} color={t.fgMuted} />
          </Pressable>
          <Text style={styles.monthLabel}>
            {y}年{m}月
          </Text>
          <Pressable onPress={() => setMonthCursor(addMonthsYmd(monthCursor, 1))} hitSlop={8}>
            <Icon icon={ChevronRight} size={18} color={t.fgMuted} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {labels.map((item) => (
            <Text key={item} style={styles.dow}>
              {item}
            </Text>
          ))}
          {cells.map((ymd, i) => {
            if (ymd === null) return <View key={`e-${i}`} style={styles.day} />;
            const isToday = ymd === today;
            const isSel = ymd === selectedYmd;
            return (
              <Pressable
                key={ymd}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel }}
                onPress={() => pickDay(ymd)}
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
        {kind === 'datetime-local' && selectedYmd !== '' ? (
          <View style={styles.timeBlock}>
            <Text style={styles.label}>{copy.todos.remindTime}</Text>
            <TimePicker value={selectedTime} onChange={(next) => onChange(`${selectedYmd}T${next}`)} />
          </View>
        ) : null}
      </PickerSheet>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: t.space[1] },
    label: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    row: { flexDirection: 'row', alignItems: 'center', gap: t.space[1] },
    trigger: {
      flex: 1,
      minHeight: t.fieldH,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      justifyContent: 'center',
      backgroundColor: t.bgSurfaceMuted,
    },
    value: { fontSize: t.type.body.fontSize, color: t.fgPrimary },
    placeholder: { color: t.fgMuted },
    clear: {
      width: t.space[8],
      height: t.space[8],
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radius.md,
    },
    clearLabel: { fontSize: t.type.title.fontSize, color: t.fgMuted, lineHeight: t.space[8] },
    monthNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: t.space[3],
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
    timeBlock: { marginTop: t.space[4], gap: t.space[2] },
  });
