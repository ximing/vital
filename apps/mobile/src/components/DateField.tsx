import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../lib/copy';
import { formatHumanDay, localDateStamp } from '../lib/format';
import { useTheme } from '../theme/use-theme';
import { CalendarPanel } from './CalendarPanel';
import { PickerSheet } from './PickerSheet';
import { TimePicker } from './TimeField';

export function DateField({
  label,
  value,
  kind,
  zone,
  weekStartsOn = 1,
  onChange,
  trigger,
}: {
  label: string;
  value: string;
  kind: 'date' | 'datetime-local';
  zone: string;
  weekStartsOn?: 0 | 1;
  onChange: (next: string) => void;
  trigger?: ReactNode;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const today = localDateStamp(zone);
  const selectedYmd = value === '' ? '' : value.slice(0, 10);
  const selectedTime = value.includes('T') ? value.slice(11, 16) : '09:00';
  const [open, setOpen] = useState(false);
  const [panelKey, setPanelKey] = useState(0);

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

  function openPicker(): void {
    setPanelKey((key) => key + 1);
    setOpen(true);
  }

  return (
    <View style={styles.wrap}>
      {trigger ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open }}
          onPress={openPicker}
        >
          {trigger}
        </Pressable>
      ) : (
        <>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ expanded: open }}
              onPress={openPicker}
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
        </>
      )}
      <PickerSheet visible={open} title={label} onClose={() => setOpen(false)}>
        {open ? (
          <CalendarPanel
            key={panelKey}
            selectedYmd={selectedYmd}
            today={today}
            weekStartsOn={weekStartsOn}
            onPickDay={pickDay}
          />
        ) : null}
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
    timeBlock: { marginTop: t.space[4], gap: t.space[2] },
  });
