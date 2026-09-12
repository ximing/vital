import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';
import { Icon } from '../ui/icon';

export type SectionHeadTone = 'default' | 'accent' | 'danger';

/**
 * spec §1.3 分组眉 eyebrow-rule：11/14/600 + letterSpacing 1 + 计数 + 发丝线延伸 + 右侧动作位。
 * tone: default（textTertiary）/ accent（置顶）/ danger（已过期）。
 * collapsible 时前置 chevron 12px，collapsed 旋转 -90°（Animated 180ms），整行可点。
 * 注：eyebrow 字号 token（11/14）尚未入 theme.ts，按 spec §3 暂写字面量。
 */
export function SectionHead({
  title,
  count,
  right,
  tone = 'default',
  first = false,
  collapsible = false,
  collapsed = false,
  onToggle,
}: {
  title: string;
  count?: number;
  right?: ReactNode;
  tone?: SectionHeadTone;
  first?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [rotate] = useState(() => new Animated.Value(collapsed ? 1 : 0));

  useEffect(() => {
    if (!collapsible) return;
    Animated.timing(rotate, {
      toValue: collapsed ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [collapsible, collapsed, rotate]);

  const labelColor =
    tone === 'accent' ? t.accentPrimary : tone === 'danger' ? t.statusOverdue : t.textTertiary;

  const body = (
    <>
      {collapsible ? (
        <Animated.View
          style={{
            transform: [
              {
                rotate: rotate.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '-90deg'],
                }),
              },
            ],
          }}
        >
          <Icon icon={ChevronDown} size={12} color={t.textTertiary} />
        </Animated.View>
      ) : null}
      <Text style={[styles.title, { color: labelColor }]}>{title}</Text>
      {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
      <View style={styles.hairline} />
      {right}
    </>
  );

  if (collapsible) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={title}
        onPress={onToggle}
        hitSlop={t.space[1]}
        style={[styles.row, first && styles.rowFirst]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={[styles.row, first && styles.rowFirst]}>{body}</View>;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      marginTop: t.space[6],
      marginBottom: t.space[2],
      paddingHorizontal: t.space[1],
    },
    rowFirst: { marginTop: t.space[2] },
    title: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '600',
      letterSpacing: 1,
    },
    count: {
      fontSize: 11,
      lineHeight: 14,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    hairline: {
      flex: 1,
      minWidth: t.space[4],
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.borderSubtle,
    },
  });
