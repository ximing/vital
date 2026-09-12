import { useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';
import { withAlpha } from '../ui/color';

/**
 * spec §1.5 按钮层级：
 * primary（实心 accentPrimary，每屏至多一个）/ ghost（bgAccentSubtle + accent 字，次级强调）
 * secondary（bgSurfaceMuted）/ quiet（透明文字钮）/ danger（danger 描边 outline，确认前不实心）。
 * size: sm h32 pad12 / md h36 pad16（= controlH）/ lg h44 满宽。
 * pressed: primary 换 accentPrimaryHover，danger 换 danger 8% 浅底，其余 opacity 0.7；disabled opacity 0.4。
 */
export type ButtonVariant = 'primary' | 'ghost' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export function Button({
  loading = false,
  loadingText,
  disabled = false,
  fullWidth = false,
  size,
  onPress,
  children,
  variant = 'primary',
  style,
}: {
  loading?: boolean;
  loadingText?: string;
  disabled?: boolean;
  /** 兼容旧调用：等价于 size="lg"。 */
  fullWidth?: boolean;
  size?: ButtonSize;
  onPress?: () => void;
  children: ReactNode;
  variant?: ButtonVariant;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const inactive = disabled || loading;
  const resolvedSize: ButtonSize = size ?? (fullWidth ? 'lg' : 'md');
  const height = resolvedSize === 'sm' ? 32 : resolvedSize === 'lg' ? 44 : t.controlH;
  const hitSlop = Math.max(0, (t.hit - height) / 2);
  const spinnerColor =
    variant === 'primary'
      ? t.fgOnAccent
      : variant === 'danger'
        ? t.danger
        : variant === 'ghost'
          ? t.accentPrimary
          : t.fgPrimary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={{ top: hitSlop, bottom: hitSlop }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        resolvedSize === 'sm' && styles.sm,
        resolvedSize === 'lg' && styles.lg,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'secondary' && styles.secondary,
        variant === 'quiet' && styles.quiet,
        variant === 'danger' && styles.danger,
        pressed && variant === 'primary' && styles.primaryPressed,
        pressed && variant === 'danger' && styles.dangerPressed,
        pressed && variant !== 'primary' && variant !== 'danger' && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={spinnerColor} /> : null}
      <Text
        style={[
          styles.label,
          variant === 'primary' && styles.labelPrimary,
          variant === 'ghost' && styles.labelGhost,
          variant === 'secondary' && styles.labelSecondary,
          variant === 'quiet' && styles.labelQuiet,
          variant === 'danger' && styles.labelDanger,
        ]}
      >
        {loading && loadingText ? loadingText : children}
      </Text>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      height: t.controlH,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[4],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space[2],
      alignSelf: 'flex-start',
    },
    sm: { height: 32, paddingHorizontal: t.space[3] },
    lg: { height: 44, alignSelf: 'stretch' },
    primary: { backgroundColor: t.accentPrimary },
    primaryPressed: { backgroundColor: t.accentPrimaryHover },
    ghost: { backgroundColor: t.bgAccentSubtle },
    secondary: { backgroundColor: t.bgSurfaceMuted },
    quiet: { backgroundColor: 'transparent' },
    danger: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: t.danger,
    },
    dangerPressed: { backgroundColor: withAlpha(t.danger, '14') },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.4 },
    label: { fontSize: t.type.meta.fontSize, fontWeight: '600' },
    labelPrimary: { color: t.fgOnAccent },
    labelGhost: { color: t.accentPrimary },
    labelSecondary: { color: t.fgPrimary },
    labelQuiet: { color: t.fgMuted, fontWeight: '500' },
    labelDanger: { color: t.danger },
  });
