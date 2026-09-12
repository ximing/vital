import { useMemo, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../lib/copy';
import { useTheme } from '../theme/use-theme';
import { Icon, type LucideIcon } from '../ui/icon';

export function PickerSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={copy.actions.cancel} />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Text style={styles.done}>{copy.todos.dateDone}</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * spec §1.4 PickerSheet 选项行：高 48，15/22 fgPrimary；destructive 选项 t.danger；
 * 选中项右侧 ✓ accentPrimary；可选左 icon 18px fgMuted。
 */
export function PickerOption({
  label,
  onPress,
  destructive = false,
  selected = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  selected?: boolean;
  icon?: LucideIcon;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
    >
      {icon ? <Icon icon={icon} size={18} color={destructive ? t.danger : t.fgMuted} /> : null}
      <Text style={[styles.optionLabel, destructive && styles.optionDestructive]} numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Icon icon={Check} size={18} color={t.accentPrimary} /> : null}
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: t.scrim,
    },
    sheet: {
      maxHeight: '78%',
      backgroundColor: t.bgElevated,
      borderTopLeftRadius: t.radius.xl,
      borderTopRightRadius: t.radius.xl,
      paddingHorizontal: t.space[4],
      paddingTop: t.space[4],
      paddingBottom: t.space[8],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: t.space[3],
    },
    title: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.fgPrimary },
    done: { fontSize: t.type.meta.fontSize, color: t.accentPrimary, fontWeight: '600' },
    option: {
      height: t.space[12],
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      paddingHorizontal: t.space[3],
      borderRadius: t.radius.md,
    },
    optionPressed: { backgroundColor: t.bgSurfaceMuted },
    optionLabel: {
      flex: 1,
      minWidth: 0,
      fontSize: 15,
      lineHeight: 22,
      color: t.fgPrimary,
    },
    optionDestructive: { color: t.danger },
  });
