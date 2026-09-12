import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';
import { rnShadow } from '../ui/card';

/**
 * spec §1.5 底部固定 action bar：默认 absolute 贴页面底部（tab 页内即 tab bar 上沿），
 * bgElevated + 顶部发丝线 + rnShadow 反向（offset y -2，radius 12）。
 * 左侧状态/辅助文字（12/16 textTertiary tabular-nums），右侧按钮组 gap 8。
 * 使用方需给内容区 paddingBottom = action bar 高度 + 16；bottom inset 默认由 tab/页面布局处理，
 * 页面容器未消费 bottom inset 时传 safeBottom 由 bar 自己垫；inline 用于 KeyboardAvoidingView
 * 内随流布局的场景（如复盘编辑器的保存 bar）。
 */
export function ActionBar({
  status,
  children,
  inline = false,
  safeBottom = false,
}: {
  status?: string;
  children?: ReactNode;
  /** true 时取消 absolute，随文档流布局（配合 KeyboardAvoidingView 使用）。 */
  inline?: boolean;
  /** true 时 paddingBottom 叠加 safe area bottom inset（页面容器未处理 inset 时使用）。 */
  safeBottom?: boolean;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        inline && styles.barInline,
        safeBottom ? { paddingBottom: t.space[3] + insets.bottom } : null,
      ]}
    >
      {status ? (
        <Text style={styles.status} numberOfLines={1}>
          {status}
        </Text>
      ) : (
        <View style={styles.statusSpacer} />
      )}
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: t.space[2],
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[3],
      backgroundColor: t.bgElevated,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borderSubtle,
      ...rnShadow(t),
      shadowOffset: { width: 0, height: -2 },
      shadowRadius: 12,
      shadowOpacity: t.scheme === 'dark' ? 0.3 : 0.06,
    },
    barInline: { position: 'relative' },
    status: {
      flexShrink: 1,
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    statusSpacer: { flex: 1 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
  });
