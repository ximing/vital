import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';
import { Icon, type LucideIcon } from '../ui/icon';

/**
 * spec §1.1: 40×40 图标按钮，hitSlop 4 保证 44 触控，图标默认 22px / strokeWidth 1.8，
 * 默认色 fgPrimary，pressed opacity 0.5。
 */
export function IconButton({
  icon,
  label,
  onPress,
  color,
  size = 22,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={t.space[1]}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
    >
      <Icon icon={icon} size={size} strokeWidth={1.8} color={color ?? t.fgPrimary} />
    </Pressable>
  );
}

const createStyles = (_t: Theme) =>
  StyleSheet.create({
    btn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.5 },
  });
