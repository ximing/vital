import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../lib/copy';
import { useTheme } from '../theme/use-theme';
import { PickerSheet } from './PickerSheet';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

function partsOf(value: string): { hour: string; minute: string } {
  const [hour = '09', minute = '00'] = value.split(':');
  return { hour: hour.padStart(2, '0'), minute: minute.padStart(2, '0') };
}

export function TimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const { hour, minute } = partsOf(value === '' ? '09:00' : value);
  const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort();

  return (
    <View style={styles.picker}>
      <View style={styles.grid}>
        {HOURS.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: item === hour }}
            accessibilityLabel={`${Number(item)}时`}
            onPress={() => onChange(`${item}:${minute}`)}
            style={[styles.chip, item === hour && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, item === hour && styles.chipLabelOn]}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.grid}>
        {minutes.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: item === minute }}
            accessibilityLabel={`${Number(item)}分`}
            onPress={() => onChange(`${hour}:${item}`)}
            style={[styles.chip, item === minute && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, item === minute && styles.chipLabelOn]}>{item}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function TimeField({
  label,
  value,
  onChange,
  disabled = false,
  clearable = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  clearable?: boolean;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [open, setOpen] = useState(false);
  const empty = value === '';

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled, expanded: open }}
          disabled={disabled}
          onPress={() => setOpen(true)}
          style={[styles.trigger, disabled && styles.disabled]}
        >
          <Text style={[styles.value, empty && styles.placeholder]}>{empty ? copy.todos.addTime : value}</Text>
        </Pressable>
        {clearable && !empty ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.todos.clearTime}
            onPress={() => onChange('')}
            style={styles.clear}
          >
            <Text style={styles.clearLabel}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <PickerSheet visible={open} title={label} onClose={() => setOpen(false)}>
        <TimePicker
          value={empty ? '09:00' : value}
          onChange={(next) => {
            onChange(next);
          }}
        />
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
    disabled: { opacity: 0.4 },
    clear: {
      width: t.space[8],
      height: t.space[8],
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radius.md,
    },
    clearLabel: { fontSize: t.type.title.fontSize, color: t.fgMuted, lineHeight: t.space[8] },
    picker: { gap: t.space[3] },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[1] },
    chip: {
      width: '15.5%',
      minHeight: t.space[8],
      borderRadius: t.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: t.accentPrimary },
    chipLabel: { fontSize: t.type.caption.fontSize, color: t.fgPrimary },
    chipLabelOn: { color: t.fgOnAccent, fontWeight: '600' },
  });
