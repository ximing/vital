import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';

/**
 * spec §1.1 大标题页头：高 52，paddingHorizontal 16，row gap 8。
 * 标题 26/34/700（t.type.display）；meta 为 baseline 对齐的副信息（13/18 textTertiary tabular-nums）。
 * leading/trailing 放 IconButton 组。页头与内容无分割线，靠留白分层。
 * onTitlePress 时标题位整体变为 Pressable（如复盘页「日报 ▾」周期选择器），
 * titleAccessory 紧跟标题（如 chevron）。
 */
export function PageHeader({
  title,
  meta,
  leading,
  trailing,
  onTitlePress,
  titleAccessory,
}: {
  title: string;
  meta?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onTitlePress?: () => void;
  titleAccessory?: ReactNode;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const titleText = (
    <Text style={styles.title} numberOfLines={1}>
      {title}
    </Text>
  );
  return (
    <View style={styles.row}>
      {leading}
      {onTitlePress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={onTitlePress}
          hitSlop={8}
          style={styles.titlePressRow}
        >
          {titleText}
          {titleAccessory}
        </Pressable>
      ) : (
        <View style={styles.titleRow}>
          {titleText}
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
      )}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      height: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      paddingHorizontal: t.space[4],
    },
    titleRow: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: t.space[2],
    },
    titlePressRow: {
      flexShrink: 1,
      minWidth: 0,
      marginRight: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    title: {
      flexShrink: 1,
      fontSize: t.type.display.fontSize,
      lineHeight: t.type.display.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
    },
    meta: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    trailing: { flexDirection: 'row', alignItems: 'center', gap: t.space[1] },
  });
