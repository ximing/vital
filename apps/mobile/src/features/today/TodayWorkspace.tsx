import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { llmReady } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { PageHeader } from '../../components/PageHeader';
import { SearchIconButton } from '../../components/SearchIconButton';
import { SectionHead } from '../../components/SectionHead';
import { SkeletonBox, SkeletonRows } from '../../components/Skeleton';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import { isOverdue, startOfLocalDayIso } from '../../lib/format';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { NewTaskBar } from '../todos/NewTaskBar';
import { AgentProposalsCard } from './AgentProposalsCard';
import { HabitLane } from './HabitLane';
import { LlmSetupBanner } from './LlmSetupBanner';
import { NowCard } from './NowCard';
import { OutcomeBoard } from './OutcomeBoard';
import { OverdueBanner } from './OverdueBanner';
import { PulseStrip } from './PulseStrip';
import { TodayTaskList } from './TodayTaskList';
import { TodayService } from './today.service';

const TodayWorkspaceContent = observer(function TodayWorkspaceContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(TodayService);
  useEffect(() => {
    s.start();
    return () => s.stop();
  }, [s]);
  useFocusReload(useCallback(() => s.reloadFromFocus(), [s]));
  const [now] = useState(() => new Date());
  const tz = s.auth.user?.timezone ?? 'UTC';
  const dashboard = s.dashboard;
  const outcomes = dashboard?.outcomes ?? [];
  const tasks = dashboard?.tasks ?? [];
  const habits = s.activeHabits;
  const inboxId = s.inboxId;
  const agentReady = llmReady(s.auth.user?.llm, 'agent.headline');
  const openCount = tasks.filter((task) => task.status !== 'done' && task.status !== 'canceled').length;
  const overdueTasks = tasks.filter((task) => isOverdue(task));
  const dateLabel = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    timeZone: tz,
  }).format(new Date());
  const weekdayLabel = new Intl.DateTimeFormat('zh-CN', {
    weekday: 'short',
    timeZone: tz,
  }).format(new Date());

  if (s.loading && dashboard === null) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <PageHeader
          title={copy.today.title}
          meta={`${dateLabel} · ${weekdayLabel}`}
          trailing={<SearchIconButton />}
        />
        <View accessibilityElementsHidden importantForAccessibility="no">
          <View style={[styles.skeletonCard, rnShadow(t)]}>
            <SkeletonBox width="42%" height={12} />
            <SkeletonBox width="78%" height={18} />
            <SkeletonBox width="56%" height={12} />
          </View>
          <View style={styles.block}>
            <SectionHead title={copy.today.tasksSection} />
            <View style={[styles.taskCard, rnShadow(t), styles.skeletonTaskCard]}>
              <SkeletonRows rows={3} />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            tintColor={t.accentPrimary}
            refreshing={s.refreshing}
            onRefresh={() => void s.refresh()}
          />
        }
      >
        <PageHeader
          title={copy.today.title}
          meta={`${dateLabel} · ${weekdayLabel}`}
          trailing={<SearchIconButton />}
        />
        {dashboard ? <PulseStrip pulse={dashboard.pulse} /> : null}
        {dashboard ? <NowCard now={dashboard.now} outcomes={outcomes} timeZone={tz} /> : null}
        {!agentReady ? <LlmSetupBanner /> : null}
        {s.offline || s.error ? (
          <View style={styles.bannerBlock}>
            {s.offline ? <Banner tone="info">{copy.offline}</Banner> : null}
            {s.error ? (
              <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => void s.refresh() }}>
                {s.error}
              </Banner>
            ) : null}
          </View>
        ) : null}

        <OverdueBanner
          tasks={overdueTasks}
          onPostpone={() => void s.postponeOverdue()}
        />

        <HabitLane
          habits={habits}
          tasks={tasks}
          onToggle={(task) => void s.completeTask(task)}
          onEnableHabit={(input) => s.enableHabit(input)}
        />

        <AgentProposalsCard />

        <View style={styles.block}>
          <OutcomeBoard
            outcomes={outcomes}
            now={now}
            onCreate={(name) => s.createOutcome(name)}
            onClose={(id) => void s.closeOutcome(id)}
            onReopen={(id) => void s.reopenOutcome(id)}
            onUndo={(id) => void s.undoOutcome(id)}
            onRetry={(id) => void s.refreshOutcome(id)}
          />

          <SectionHead title={copy.today.tasksSection} count={openCount} />
          <View style={[styles.taskCard, rnShadow(t)]}>
            <TodayTaskList
              tasks={tasks}
              tags={s.tags}
              lists={s.lists}
              onComplete={(task) => void s.completeTask(task)}
            />
            {inboxId ? (
              <NewTaskBar
                listId={inboxId}
                extra={{ dueAt: startOfLocalDayIso(tz), isAllDay: true, timezone: tz }}
                onCreated={(task) => {
                  s.applyTask(task);
                  void s.refresh();
                }}
              />
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
});

export const TodayWorkspace = bindServices(TodayWorkspaceContent, [TodayService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    // spec §f.8：无 FAB，底部 24。水平留白由各区块自理——chips/习惯车道需要全宽横滚。
    scroll: { paddingBottom: t.space[6] },
    block: { paddingHorizontal: t.space[4] },
    bannerBlock: {
      paddingHorizontal: t.space[4],
      marginTop: t.space[3],
      gap: t.space[2],
    },
    // spec §1.2 内容卡：bgElevated + radius.lg + rnShadow，无描边。
    taskCard: {
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
      overflow: 'hidden',
      paddingBottom: t.space[2],
    },
    // 首载骨架：NowCard 卡骨架（白卡轮廓内 3 条横条，spec §1.8）+ 3 行任务行骨架。
    skeletonCard: {
      marginTop: t.space[2],
      marginBottom: t.space[5],
      marginHorizontal: t.space[4],
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
      padding: t.space[4],
      gap: t.space[2],
    },
    skeletonTaskCard: { padding: t.space[4] },
  });
