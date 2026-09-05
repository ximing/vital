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

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export function Button({
  loading = false,
  loadingText,
  disabled = false,
  fullWidth = false,
  onPress,
  children,
  variant = 'primary',
  style,
}: {
  loading?: boolean;
  loadingText?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  onPress?: () => void;
  children: ReactNode;
  variant?: ButtonVariant;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const inactive = disabled || loading;
  const height = fullWidth ? t.controlHProminent : t.controlH;
  const hitSlop = Math.max(0, (t.hit - height) / 2);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={{ top: hitSlop, bottom: hitSlop }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'quiet' && styles.quiet,
        variant === 'danger' && styles.danger,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'danger' ? t.fgOnAccent : t.fgPrimary}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          variant === 'primary' && styles.labelPrimary,
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
    fullWidth: { height: t.controlHProminent, alignSelf: 'stretch' },
    primary: { backgroundColor: t.accentPrimary },
    secondary: { backgroundColor: t.bgSurfaceMuted },
    quiet: { backgroundColor: 'transparent' },
    danger: { backgroundColor: t.danger },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.4 },
    label: { fontSize: t.type.meta.fontSize, fontWeight: '600' },
    labelPrimary: { color: t.fgOnAccent },
    labelSecondary: { color: t.fgPrimary },
    labelQuiet: { color: t.fgMuted, fontWeight: '500' },
    labelDanger: { color: t.fgOnAccent },
  });
