import { useEffect, useMemo } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';

/**
 * spec §1.8 骨架屏：基础块 bgSurfaceMuted + radius，Animated opacity 0.5 ↔ 1
 * 往返（单程 1200ms，useNativeDriver）。仅首屏加载使用；有数据后的刷新仍走 RefreshControl。
 * 暗色下 bgSurfaceMuted 自然适配，无需额外处理。
 */
function useBreath(): Animated.Value {
  const opacity = useMemo(() => new Animated.Value(0.5), []);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 1200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

export function SkeletonBox({
  width,
  height = 14,
  radius,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const opacity = useBreath();
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius ?? t.radius.sm,
          backgroundColor: t.bgSurfaceMuted,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** 列表行骨架：n 行（24 圆 + 两行条 60% / 40%），对齐任务行解剖（spec §1.8）。 */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.rows} accessibilityElementsHidden importantForAccessibility="no">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <SkeletonBox width={24} height={24} radius={t.radius.pill} />
          <View style={styles.rowBody}>
            <SkeletonBox width="60%" height={14} />
            <SkeletonBox width="40%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    rows: { gap: t.space[5] },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space[3] },
    rowBody: { flex: 1, minWidth: 0, gap: t.space[2] },
  });
