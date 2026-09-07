import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';
import { PickerSheet } from './PickerSheet';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.trigger, disabled && styles.disabled]}
      >
        <Text style={[styles.value, !selected && styles.placeholder]} numberOfLines={1}>
          {selected?.label ?? ''}
        </Text>
      </Pressable>
      <PickerSheet visible={open} title={label} onClose={() => setOpen(false)}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              disabled={option.disabled}
              onPress={() => {
                if (option.disabled) return;
                onChange(option.value);
                setOpen(false);
              }}
              style={[styles.option, active && styles.optionActive]}
            >
              <Text
                style={[
                  styles.optionLabel,
                  active && styles.optionLabelActive,
                  option.disabled && styles.disabled,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </PickerSheet>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: t.space[1] },
    label: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    trigger: {
      minHeight: t.fieldH,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      justifyContent: 'center',
      backgroundColor: t.bgSurfaceMuted,
    },
    value: { fontSize: t.type.body.fontSize, color: t.fgPrimary },
    placeholder: { color: t.fgMuted },
    disabled: { opacity: 0.4 },
    option: {
      minHeight: t.hit,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      justifyContent: 'center',
    },
    optionActive: { backgroundColor: t.bgAccentSubtle },
    optionLabel: { fontSize: t.type.body.fontSize, color: t.fgPrimary },
    optionLabelActive: { fontWeight: '600' },
  });
