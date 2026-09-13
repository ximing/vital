import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import type { CreateHabitInput, Habit } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { SectionHead } from '../../components/SectionHead';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { HabitEmptyCard } from './HabitEmptyCard';
import { habitProgress } from './model';

const LANE_GAP = 8;
const VISIBLE_CARDS = 3;
const RING = 28;
const RING_STROKE = 2.5;
const RING_R = (RING - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

/** Track + arc; full fill + ✓ once today's target is met (web HabitRing). */
function HabitRing({
  done,
  total,
  complete,
  color,
  track,
  fillBg,
  fillFg,
}: {
  done: number;
  total: number;
  complete: boolean;
  color: string;
  track: string;
  fillBg: string;
  fillFg: string;
}) {
  if (complete) {
    return (
      <View style={[ringStyles.fill, { backgroundColor: fillBg }]}>
        <Icon icon={Check} size={14} strokeWidth={3} color={fillFg} />
      </View>
    );
  }
  const progress = total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <View style={ringStyles.box}>
      <Svg width={RING} height={RING} style={ringStyles.svg}>
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={RING_R}
          fill="none"
          stroke={track}
          strokeWidth={RING_STROKE}
        />
        {progress > 0 ? (
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_R}
            fill="none"
            stroke={color}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${RING_C} ${RING_C}`}
            strokeDashoffset={RING_C * (1 - progress)}
          />
        ) : null}
      </Svg>
    </View>
  );
}

function HabitCard({
  habit,
  width,
  flex,
  onTick,
}: {
  habit: Habit;
  width?: number;
  flex?: number;
  onTick: (habit: Habit) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const { done, total, complete } = habitProgress(habit);
  const canTick = !complete;
  const sub = complete
    ? copy.habits.todayDone
    : copy.today.habitLaneToday.replace('{done}', String(done)).replace('{total}', String(total));

  return (
    <View
      testID="habit-card"
      style={[styles.card, rnShadow(t), flex !== undefined ? { flex } : { width }]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: complete, disabled: !canTick }}
        accessibilityLabel={habit.name}
        disabled={!canTick}
        hitSlop={8}
        onPress={() => {
          if (canTick) onTick(habit);
        }}
        style={styles.ringHit}
      >
        <HabitRing
          done={done}
          total={total}
          complete={complete}
          color={t.statusDone}
          track={t.borderSubtle}
          fillBg={t.statusDone}
          fillFg={t.fgOnAccent}
        />
      </Pressable>
      <View style={styles.copy}>
        <Text style={styles.name} numberOfLines={1}>
          {habit.name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </View>
  );
}

/**
 * 习惯车道：一排最多三张横条卡（左打卡、右名称+今日进度）。超过三张横滑。
 */
export function HabitLane({
  habits,
  onTick,
  onEnableHabit,
}: {
  habits: Habit[];
  onTick: (habit: Habit) => void;
  onEnableHabit: (input: CreateHabitInput) => Promise<void>;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth =
    (windowWidth - t.space[4] * 2 - LANE_GAP * (VISIBLE_CARDS - 1)) / VISIBLE_CARDS;
  const overflow = habits.length > VISIBLE_CARDS;

  return (
    <View>
      <View style={styles.headWrap}>
        <SectionHead
          title={copy.today.habitLane}
          count={habits.length > 0 ? habits.length : undefined}
          right={
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/habits')}
              hitSlop={8}
            >
              <Text style={styles.manage}>{copy.today.manageHabits}</Text>
            </Pressable>
          }
        />
      </View>
      {habits.length === 0 ? (
        <View style={styles.emptyWrap}>
          <HabitEmptyCard onEnable={onEnableHabit} />
        </View>
      ) : overflow ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.lane}
        >
          {habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              width={cardWidth}
              onTick={onTick}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.lane}>
          {habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              flex={1}
              onTick={onTick}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    headWrap: { paddingHorizontal: t.space[4] },
    manage: { fontSize: t.type.caption.fontSize, fontWeight: '500', color: t.accentPrimary },
    emptyWrap: { paddingHorizontal: t.space[4] },
    lane: {
      flexDirection: 'row',
      gap: LANE_GAP,
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[1],
    },
    card: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
      paddingHorizontal: t.space[3],
      paddingVertical: t.space[2],
    },
    ringHit: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    copy: { flex: 1, minWidth: 0 },
    name: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    sub: {
      marginTop: 1,
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
  });

const ringStyles = StyleSheet.create({
  box: { width: RING, height: RING },
  svg: { transform: [{ rotate: '-90deg' }] },
  fill: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
