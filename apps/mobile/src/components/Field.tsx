import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';

export function Field({
  label,
  isInvalid = false,
  onFocus,
  onBlur,
  multiline = false,
  ...inputProps
}: TextInputProps & { label?: string; isInvalid?: boolean }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[
          styles.input,
          multiline && styles.multiline,
          focused && styles.inputFocused,
          isInvalid && styles.inputInvalid,
        ]}
        placeholderTextColor={t.fgMuted}
        autoCapitalize="none"
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...inputProps}
      />
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: t.space[1] },
    label: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    input: {
      minHeight: t.fieldH,
      borderWidth: t.focusRingW,
      borderColor: 'transparent',
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      fontSize: t.type.body.fontSize,
      color: t.fgPrimary,
      backgroundColor: t.bgSurfaceMuted,
    },
    multiline: { minHeight: t.space[12] * 2, paddingVertical: t.space[3] },
    inputFocused: { borderColor: t.borderFocus },
    inputInvalid: { borderColor: t.danger },
  });
