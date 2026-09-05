import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { EntityKind } from '@vital/markdown';
import type { TaskStatus } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { pinKindColor } from '../features/reports/chip-label';
import { useTheme } from '../theme/use-theme';

export function EntityChip({
  kind,
  label,
  status,
  onPress,
}: {
  kind: EntityKind;
  label: string;
  status?: TaskStatus;
  onPress?: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const pin = pinKindColor(kind, t);
  const done = status === 'done';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, done && styles.done]}
    >
      <View style={[styles.pin, { backgroundColor: pin }]} />
      <Text style={[styles.label, done && styles.labelDone]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[1],
      maxWidth: '100%',
      paddingHorizontal: t.space[2],
      paddingVertical: t.space[1],
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
    },
    done: { backgroundColor: t.bgSurfaceMuted },
    pin: {
      width: t.space[2],
      height: t.space[2],
      borderRadius: t.radius.pill,
    },
    label: {
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.fgPrimary,
      fontWeight: '600',
      maxWidth: t.space[12] * 4,
    },
    labelDone: { color: t.fgMuted, textDecorationLine: 'line-through' },
  });
