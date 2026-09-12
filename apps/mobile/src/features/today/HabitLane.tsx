import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import type { CreateHabitInput, Habit, Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { SectionHead } from '../../components/SectionHead';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { HabitEmptyCard } from './HabitEmptyCard';

const LANE_GAP = 8;
const VISIBLE_CARDS = 3;

/** Today's live instance for a habit (relay spawns one at a time — take the newest). */
export function habitTodayTask(tasks: Task[], habitId: string): Task | null {
  let found: Task | null = null;
  for (const task of tasks) {
    if (task.habitId !== habitId || task.deletedAt !== null) continue;
    if (found === null || task.createdAt > found.createdAt) found = task;
  }
  return found;
}

function HabitCard({
  habit,
  task,
  width,
  flex,
  onToggle,
}: {
  habit: Habit;
  task: Task | null;
  width?: number;
  flex?: number;
  onToggle: (task: Task) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const done = task !== null && task.status === 'done';
  const total =
    habit.kind === 'count' && habit.targetCount !== null ? habit.targetCount : habit.todayTotal;
  const sub =
    total > 0
      ? copy.today.habitLaneToday
          .replace('{done}', String(habit.todayDone))
          .replace('{total}', String(total))
      : ' ';

  return (
    <View
      testID="habit-card"
      style={[styles.card, rnShadow(t), flex !== undefined ? { flex } : { width }]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled: task === null }}
        accessibilityLabel={habit.name}
        disabled={task === null}
        hitSlop={t.space[2]}
        onPress={() => {
          if (task) onToggle(task);
        }}
        style={[styles.ring, done && styles.ringDone, task === null && styles.ringDisabled]}
      >
        {done ? <Icon icon={Check} size={14} strokeWidth={3} color={t.fgOnAccent} /> : null}
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
  tasks,
  onToggle,
  onEnableHabit,
}: {
  habits: Habit[];
  tasks: Task[];
  onToggle: (task: Task) => void;
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
              task={habitTodayTask(tasks, habit.id)}
              onToggle={onToggle}
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
              task={habitTodayTask(tasks, habit.id)}
              onToggle={onToggle}
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
    ring: {
      width: 28,
      height: 28,
      borderRadius: t.radius.pill,
      borderWidth: 1.5,
      borderColor: t.textTertiary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ringDone: { backgroundColor: t.statusDone, borderColor: t.statusDone },
    ringDisabled: { opacity: 0.4 },
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
