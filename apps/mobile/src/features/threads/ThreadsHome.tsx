import { useCallback, useEffect, useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { Stack, router } from 'expo-router';
import {
  Archive,
  ChevronLeft,
  Ellipsis,
  MessagesSquare,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide-react-native';
import type { Outcome, OutcomeSignal } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { IconButton } from '../../components/IconButton';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { SectionHead } from '../../components/SectionHead';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { cardStyle, rnShadow } from '../../ui/card';
import { withAlpha } from '../../ui/color';
import { ThreadsService } from './threads.service';

function signalColors(signal: OutcomeSignal, t: Theme): { fg: string; bg: string } {
  if (signal === 'up') return { fg: t.accentPrimary, bg: t.bgAccentSubtle };
  if (signal === 'alert') return { fg: t.statusDueSoon, bg: withAlpha(t.statusDueSoon, '1F') };
  return { fg: t.textTertiary, bg: t.bgSurfaceMuted };
}

/** 卡片状态文案：agent 更新中 > headline/下一步 > 兜底。 */
function statusText(outcome: Outcome): string | null {
  if (outcome.agentState === 'pending') return copy.threads.updating;
  return outcome.agentHeadline ?? outcome.ruleNextStep;
}

function statLine(outcome: Outcome): string {
  const parts = [
    copy.threads.openTasks.replace('{n}', String(outcome.openTaskCount)),
    copy.threads.doneLast7d.replace('{n}', String(outcome.completedLast7d)),
  ];
  if (outcome.materialCount > 0) {
    parts.push(copy.threads.materials.replace('{n}', String(outcome.materialCount)));
  }
  return parts.join(' · ');
}

const ThreadsHomeContent = observer(function ThreadsHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(ThreadsService);
  useEffect(() => {
    s.start();
    return () => s.stop();
  }, [s]);
  useFocusReload(useCallback(() => s.reloadFromFocus(), [s]));

  const open = s.open;
  const closed = s.closed;
  const menuOutcome = s.menuOutcome;

  function renderOpenCard(outcome: Outcome) {
    const text = statusText(outcome);
    const signal = outcome.ruleSignal ? signalColors(outcome.ruleSignal, t) : null;
    return (
      <Pressable
        key={outcome.id}
        accessibilityRole="button"
        accessibilityLabel={outcome.name}
        onPress={() => router.push(`/threads/${outcome.id}`)}
        onLongPress={() => s.openMenu(outcome)}
        delayLongPress={320}
        style={({ pressed }) => [cardStyle(t), rnShadow(t), styles.card, pressed && styles.pressed]}
      >
        <View style={styles.cardHead}>
          <Text style={styles.cardName} numberOfLines={1}>
            {outcome.name}
          </Text>
          {outcome.createdBy === 'agent' ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{copy.threads.agentBadge}</Text>
            </View>
          ) : null}
          {signal && outcome.ruleSignal ? (
            <View style={[styles.chip, { backgroundColor: signal.bg }]}>
              <Text style={[styles.chipText, { color: signal.fg }]}>
                {copy.today.signal[outcome.ruleSignal]}
              </Text>
            </View>
          ) : null}
        </View>
        {text !== null ? (
          <Text style={styles.cardStatus} numberOfLines={2}>
            {text}
          </Text>
        ) : null}
        <Text style={styles.cardMeta} numberOfLines={1}>
          {statLine(outcome)}
        </Text>
      </Pressable>
    );
  }

  if (s.loading) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <Loading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        title={copy.threads.title}
        leading={
          <IconButton icon={ChevronLeft} label={copy.back} onPress={() => router.back()} />
        }
        trailing={
          <IconButton icon={Plus} label={copy.threads.add} onPress={() => s.openCreate()} />
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
        {s.error !== null && open.length === 0 && closed.length === 0 ? (
          <Banner action={{ label: copy.actions.retry, onPress: () => void s.load(false) }}>{s.error}</Banner>
        ) : (
          <>
            <SectionHead title={copy.threads.openGroup} count={open.length} first />
            {open.length === 0 ? (
              <EmptyState
                icon={MessagesSquare}
                title={copy.threads.empty}
                action={{
                  label: copy.threads.add,
                  onPress: () => s.openCreate(),
                }}
              />
            ) : (
              <View style={styles.cardList}>{open.map(renderOpenCard)}</View>
            )}

            <SectionHead title={copy.threads.closedGroup} count={closed.length} />
            {closed.length === 0 ? (
              <Text style={styles.closedEmpty}>{copy.threads.closedEmpty}</Text>
            ) : (
              <View style={[cardStyle(t), rnShadow(t)]}>
                {closed.map((outcome, index) => (
                  <Pressable
                    key={outcome.id}
                    accessibilityRole="button"
                    accessibilityLabel={outcome.name}
                    onPress={() => router.push(`/threads/${outcome.id}`)}
                    onLongPress={() => s.openMenu(outcome)}
                    delayLongPress={320}
                    style={({ pressed }) => [
                      styles.closedRow,
                      index < closed.length - 1 && styles.closedRowBorder,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.closedBody}>
                      <Text style={styles.closedName} numberOfLines={1}>
                        {outcome.name}
                      </Text>
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        {copy.threads.closedAt.replace('{date}', outcome.updatedAt.slice(0, 10))}
                        {' · '}
                        {statLine(outcome)}
                      </Text>
                    </View>
                    <IconButton
                      icon={Ellipsis}
                      label={copy.todos.more}
                      size={20}
                      color={t.fgMuted}
                      onPress={() => s.openMenu(outcome)}
                    />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <PickerSheet
        visible={menuOutcome !== null}
        title={menuOutcome?.name ?? ''}
        onClose={() => s.closeMenu()}
      >
        {menuOutcome ? (
          <>
            <PickerOption
              icon={Pencil}
              label={copy.threads.rename}
              onPress={() => s.openRename(menuOutcome)}
            />
            {menuOutcome.status === 'open' ? (
              <PickerOption
                icon={Archive}
                label={copy.threads.close}
                onPress={() => void s.close(menuOutcome)}
              />
            ) : (
              <PickerOption
                icon={RotateCcw}
                label={copy.threads.reopen}
                onPress={() => void s.reopen(menuOutcome)}
              />
            )}
          </>
        ) : null}
      </PickerSheet>

      <BottomSheet visible={s.creating} onClose={() => s.closeCreate()}>
        <View style={styles.form}>
          <Text style={styles.formTitle}>{copy.threads.add}</Text>
          <Field
            label={copy.threads.title}
            value={s.newName}
            onChangeText={(name) => s.setNewName(name)}
            placeholder={copy.threads.namePlaceholder}
            maxLength={120}
            autoCapitalize="sentences"
          />
          <Button
            size="lg"
            loading={s.saving}
            disabled={s.newName.trim() === ''}
            onPress={() => void s.submitCreate()}
          >
            {copy.today.create}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet visible={s.renaming !== null} onClose={() => s.closeRename()}>
        <View style={styles.form}>
          <Text style={styles.formTitle}>{copy.threads.renameTitle}</Text>
          <Field
            label={copy.threads.title}
            value={s.renameName}
            onChangeText={(name) => s.setRenameName(name)}
            maxLength={120}
            autoCapitalize="sentences"
          />
          <Button
            size="lg"
            loading={s.saving}
            disabled={s.renameName.trim() === ''}
            onPress={() => void s.submitRename()}
          >
            {copy.actions.save}
          </Button>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
});

export const ThreadsHome = bindServices(ThreadsHomeContent, [ThreadsService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    content: { padding: t.space[4], paddingBottom: t.space[10] },
    pressed: { opacity: 0.7 },
    cardList: { gap: t.space[3] },
    card: { padding: t.space[4], gap: t.space[2] },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
    cardName: {
      flex: 1,
      minWidth: 0,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    badge: {
      height: 20,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
      paddingHorizontal: t.space[2],
      justifyContent: 'center',
    },
    badgeText: { fontSize: 11, fontWeight: '600', color: t.accentPrimary },
    chip: {
      height: 24,
      borderRadius: t.radius.pill,
      paddingHorizontal: 10,
      justifyContent: 'center',
    },
    chipText: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
    cardStatus: { fontSize: 13, lineHeight: 19, color: t.fgMuted },
    cardMeta: { fontSize: 12, lineHeight: 16, color: t.textTertiary, fontVariant: ['tabular-nums'] },
    closedEmpty: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textTertiary,
      paddingHorizontal: t.space[1],
    },
    closedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[3],
    },
    closedRowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borderSubtle,
    },
    closedBody: { flex: 1, minWidth: 0, gap: 2 },
    closedName: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: t.fgMuted },
    form: { padding: t.space[4], gap: t.space[3] },
    formTitle: {
      fontSize: t.type.section.fontSize,
      lineHeight: t.type.section.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
    },
  });
