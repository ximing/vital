import { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { Stack, router } from 'expo-router';
import { Activity, ChevronLeft } from 'lucide-react-native';
import type {
  AgentActionLogItem,
  AgentExecution,
  AgentScheduleStatus,
} from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { SectionHead } from '../../components/SectionHead';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import { formatDateTime, formatHm } from '../../lib/format';
import { useTheme } from '../../theme/use-theme';
import { cardStyle, rnShadow } from '../../ui/card';
import { withAlpha } from '../../ui/color';
import { ActivityService } from './activity.service';

function actionLabel(actionType: string): string {
  const labels: Record<string, string> = copy.activity.actions;
  return labels[actionType] ?? actionType;
}

function capabilityLabel(capability: string): string {
  const labels: Record<string, string> = copy.activity.capabilities;
  return labels[capability] ?? capability;
}

function detailText(item: AgentActionLogItem): string {
  const summary = item.payloadSummary.trim();
  if (item.targetName !== null) {
    return summary === '' ? item.targetName : `${item.targetName}：${summary}`;
  }
  return summary === '' ? copy.activity.deletedTarget : summary;
}

function executionColor(status: AgentExecution['status'], t: Theme): string {
  if (status === 'running') return t.accentPrimary;
  if (status === 'succeeded') return t.statusDone;
  if (status === 'failed') return t.statusOverdue;
  return t.statusDueSoon;
}

function scheduleChipColors(status: AgentScheduleStatus, t: Theme): { fg: string; bg: string } {
  if (status === 'waiting') return { fg: t.accentPrimary, bg: t.bgAccentSubtle };
  if (status === 'due') return { fg: t.statusDueSoon, bg: withAlpha(t.statusDueSoon, '1F') };
  if (status === 'cooldown') return { fg: t.statusDoing, bg: withAlpha(t.statusDoing, '1F') };
  return { fg: t.textTertiary, bg: t.bgSurfaceMuted };
}

const ActivityHomeContent = observer(function ActivityHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(ActivityService);
  useFocusReload(useCallback(() => s.reloadFromFocus(), [s]));
  const tz = s.tz;
  const actions = s.actions;
  const executions = s.executions;
  const schedule = s.schedule;
  const sortedActions = s.sortedActions;
  const busyId = s.busyId;

  if (s.loading) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <Loading />
      </SafeAreaView>
    );
  }

  const emptyAll = actions.length === 0 && executions.length === 0;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        title={copy.activity.title}
        leading={
          <IconButton icon={ChevronLeft} label={copy.back} onPress={() => router.back()} />
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={s.refreshing}
            onRefresh={() => void s.load(true)}
            tintColor={t.accentPrimary}
          />
        }
      >
        {s.error !== null && actions.length === 0 && executions.length === 0 ? (
          <Banner action={{ label: copy.actions.retry, onPress: () => void s.load(false) }}>{s.error}</Banner>
        ) : emptyAll ? (
          <EmptyState icon={Activity} title={copy.activity.emptyProposals} />
        ) : (
          <>
            <SectionHead title={copy.activity.proposals} count={actions.length} first />
            {actions.length === 0 ? (
              <Text style={styles.emptyLine}>{copy.activity.emptyProposals}</Text>
            ) : (
              <View style={[cardStyle(t), rnShadow(t)]}>
                {sortedActions.map((item, index) => (
                  <View
                    key={item.id}
                    style={[styles.row, index < sortedActions.length - 1 && styles.rowBorder]}
                  >
                    <View style={styles.pill}>
                      <Text style={styles.pillLabel}>{actionLabel(item.actionType)}</Text>
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {detailText(item)}
                      </Text>
                      <Text style={styles.rowTime}>{formatHm(item.createdAt, tz)}</Text>
                    </View>
                    {item.feedback === 'pending' ? (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          disabled={busyId !== null}
                          onPress={() => void s.sendFeedback(item.id, 'accepted')}
                          style={styles.accept}
                        >
                          <Text style={styles.acceptLabel}>{copy.activity.accept}</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          disabled={busyId !== null}
                          hitSlop={8}
                          onPress={() => void s.sendFeedback(item.id, 'dismissed')}
                        >
                          <Text style={styles.dismiss}>{copy.activity.dismiss}</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Text style={styles.resultText}>{copy.activity.results[item.feedback]}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            <SectionHead title={copy.activity.executions} count={executions.length} />
            {executions.length === 0 ? (
              <Text style={styles.emptyLine}>{copy.activity.emptyExecutions}</Text>
            ) : (
              <View style={[cardStyle(t), rnShadow(t)]}>
                {executions.map((execution, index) => {
                  const color = executionColor(execution.status, t);
                  const summary = execution.resultSummary ?? copy.activity.noResult;
                  return (
                    <View
                      key={execution.id}
                      style={[styles.execRow, index < executions.length - 1 && styles.rowBorder]}
                    >
                      <View style={[styles.dot, { backgroundColor: color }]} />
                      <View style={styles.rowBody}>
                        <View style={styles.execHead}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {capabilityLabel(execution.capability)}
                          </Text>
                          <Text style={[styles.execStatus, { color }]}>
                            {copy.activity.statuses[execution.status]}
                          </Text>
                          <Text style={styles.rowTime}>
                            {formatDateTime(execution.createdAt, tz)}
                          </Text>
                        </View>
                        <Text style={styles.execSummary} numberOfLines={2}>
                          {summary}
                        </Text>
                        {execution.durationMs !== null ? (
                          <Text style={styles.rowTime}>
                            {`${(execution.durationMs / 1000).toFixed(1)}s`}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <SectionHead title={copy.activity.schedule} count={schedule.length} />
            <View style={[cardStyle(t), rnShadow(t)]}>
              {schedule.map((item, index) => {
                const chip = scheduleChipColors(item.status, t);
                return (
                  <View
                    key={item.capability}
                    style={[styles.row, index < schedule.length - 1 && styles.rowBorder]}
                  >
                    <View style={styles.rowBody}>
                      <View style={styles.execHead}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {capabilityLabel(item.capability)}
                        </Text>
                        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                          <Text style={[styles.chipText, { color: chip.fg }]}>
                            {copy.activity.scheduleStatuses[item.status]}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.rowTime} numberOfLines={1}>
                        {item.pendingCount > 0
                          ? `${copy.activity.schedulePending.replace('{n}', String(item.pendingCount))} · `
                          : ''}
                        {item.lastSucceededAt
                          ? copy.activity.scheduleLast.replace(
                              '{time}',
                              formatDateTime(item.lastSucceededAt, tz),
                            )
                          : copy.activity.scheduleNever}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => void s.runNow(item)}
                    >
                      <Text style={styles.runNow}>{copy.activity.runNow}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: item.status === 'idle' }}
                      disabled={item.status === 'idle'}
                      hitSlop={8}
                      onPress={() => void s.cancelPending(item)}
                      style={item.status === 'idle' && styles.disabled}
                    >
                      <Text style={styles.dismiss}>{copy.activity.cancelPending}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
});

export const ActivityHome = bindServices(ActivityHomeContent, [ActivityService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    content: { padding: t.space[4], paddingBottom: t.space[10] },
    emptyLine: {
      paddingHorizontal: t.space[1],
      paddingVertical: t.space[3],
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textTertiary,
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: t.space[2],
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[3],
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borderSubtle,
    },
    rowBody: { flex: 1, minWidth: 120, gap: 2 },
    rowTitle: {
      flexShrink: 1,
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      fontWeight: '500',
      color: t.fgPrimary,
    },
    rowTime: {
      fontSize: t.type.caption.fontSize,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    pill: {
      height: 22,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
      paddingHorizontal: t.space[2],
      justifyContent: 'center',
    },
    pillLabel: { fontSize: 11, fontWeight: '600', color: t.accentPrimary },
    accept: {
      height: 28,
      borderRadius: t.radius.pill,
      backgroundColor: t.accentPrimary,
      paddingHorizontal: t.space[3],
      justifyContent: 'center',
    },
    acceptLabel: { fontSize: t.type.caption.fontSize, fontWeight: '600', color: t.fgOnAccent },
    dismiss: { fontSize: t.type.caption.fontSize, fontWeight: '500', color: t.fgMuted },
    resultText: { fontSize: t.type.caption.fontSize, color: t.textTertiary },
    runNow: { fontSize: t.type.caption.fontSize, fontWeight: '600', color: t.accentPrimary },
    disabled: { opacity: 0.4 },
    execRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: t.space[3],
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[3],
    },
    dot: { width: 8, height: 8, borderRadius: t.radius.pill, marginTop: 5 },
    execHead: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
    execStatus: { fontSize: t.type.caption.fontSize, fontWeight: '600' },
    execSummary: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.fgMuted,
    },
    chip: {
      height: 20,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.space[2],
      justifyContent: 'center',
    },
    chipText: { fontSize: 11, fontWeight: '600' },
  });
