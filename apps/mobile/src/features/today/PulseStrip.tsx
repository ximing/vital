import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { Check, Flame, Package } from 'lucide-react-native';
import type { TodayPulse } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { Icon } from '../../ui/icon';
import { TodayService } from './today.service';

/**
 * spec §f.2 PulseStrip：筛选 chip 横滚（白卡描边，icon 14 + 13px 文案，计数 tabular-nums）。
 * 复盘连续带 Flame（statusDueSoon），今日已写带绿勾（statusDone）。可点 chip 跳对应页。
 */
const AgentStatusChip = observer(function AgentStatusChip() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(TodayService);
  const running = s.agentRunningCount;
  const failed = s.agentFailedCount;
  if (running > 0) {
    return (
      <Pressable accessibilityRole="button" onPress={() => router.push('/activity')} style={styles.chip}>
        <Icon icon={Flame} size={14} color={t.accentPrimary} />
        <Text style={styles.chipText}>
          {copy.today.agentStatus.running.replace('{n}', String(running))}
        </Text>
      </Pressable>
    );
  }
  if (failed > 0) {
    return (
      <Pressable accessibilityRole="button" onPress={() => router.push('/activity')} style={styles.chip}>
        <Icon icon={Flame} size={14} color={t.statusDueSoon} />
        <Text style={[styles.chipText, { color: t.statusDueSoon }]}>
          {copy.today.agentStatus.attention.replace('{n}', String(failed))}
        </Text>
      </Pressable>
    );
  }
  return null;
});

export function PulseStrip({ pulse }: { pulse: TodayPulse }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/inbox')}
        style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      >
        <Icon icon={Package} size={14} color={t.fgMuted} />
        <Text style={styles.chipStrong}>{pulse.inboxPending}</Text>
        <Text style={styles.chipText}>{copy.today.pulseInboxSuffix}</Text>
      </Pressable>
      {pulse.reportStreak > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/reports')}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
        >
          <Icon icon={Flame} size={14} color={t.statusDueSoon} />
          <Text style={styles.chipText}>{copy.today.pulseStreakPrefix}</Text>
          <Text style={styles.chipStrong}>{pulse.reportStreak}</Text>
          <Text style={styles.chipText}>{copy.today.pulseStreakSuffix}</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/reports')}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
        >
          <Text style={[styles.chipText, styles.tertiary]}>{copy.today.pulseNoStreak}</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/reports')}
        style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      >
        {pulse.todayReportId ? (
          <>
            <Icon icon={Check} size={14} strokeWidth={2.4} color={t.statusDone} />
            <Text style={styles.chipText}>{copy.today.pulseReportDone}</Text>
          </>
        ) : (
          <>
            <Text style={[styles.chipText, styles.tertiary]}>{copy.today.pulseReportTodo}</Text>
            <Text style={styles.go}>{copy.today.pulseGo}</Text>
          </>
        )}
      </Pressable>
      <AgentStatusChip />
    </ScrollView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      paddingHorizontal: t.space[4],
      paddingTop: t.space[1],
      paddingBottom: t.space[2],
    },
    chip: {
      height: t.space[8],
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.borderSubtle,
      backgroundColor: t.bgElevated,
      paddingHorizontal: t.space[3],
    },
    pressed: { opacity: 0.7 },
    chipText: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      fontWeight: '500',
      color: t.fgMuted,
    },
    chipStrong: {
      fontSize: t.type.meta.fontSize,
      fontWeight: '700',
      color: t.fgPrimary,
      fontVariant: ['tabular-nums'],
    },
    tertiary: { color: t.textTertiary },
    go: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.accentPrimary },
  });
