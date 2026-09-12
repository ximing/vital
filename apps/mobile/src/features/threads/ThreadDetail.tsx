import { useCallback, useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { Stack, router } from 'expo-router';
import { Archive, ChevronLeft, Ellipsis, Pencil, RotateCcw, Unlink } from 'lucide-react-native';
import type { OutcomeSignal } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { IconButton } from '../../components/IconButton';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { SectionHead } from '../../components/SectionHead';
import { TaskRow } from '../../components/TaskRow';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import { useOpenTask } from '../../components/TaskSheetHost';
import { relativeTime } from '../inbox/model';
import { useTheme } from '../../theme/use-theme';
import { withAlpha } from '../../ui/color';
import { ThreadDetailService } from './threads.service';

function signalColors(signal: OutcomeSignal, t: Theme): { fg: string; bg: string } {
  if (signal === 'up') return { fg: t.accentPrimary, bg: t.bgAccentSubtle };
  if (signal === 'alert') return { fg: t.statusDueSoon, bg: withAlpha(t.statusDueSoon, '1F') };
  return { fg: t.textTertiary, bg: t.bgSurfaceMuted };
}

const ThreadDetailContent = observer(function ThreadDetailContent({ outcomeId }: { outcomeId: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const openTask = useOpenTask();
  const s = useService(ThreadDetailService);
  useEffect(() => {
    s.configure(outcomeId);
    return () => s.stop();
  }, [s, outcomeId]);
  useFocusReload(
    useCallback(async () => {
      s.configure(outcomeId);
      await s.reloadFromFocus();
    }, [s, outcomeId]),
  );

  const detail = s.detail;
  const outcome = detail?.outcome ?? null;
  const openTasks = s.openTasks;
  const doneTasks = s.doneTasks;
  const attachCandidates = s.attachCandidates;
  const menuMaterial = s.menuMaterial;

  if (s.loading) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (detail === null || outcome === null) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <PageHeader
          title={copy.threads.title}
          leading={
            <IconButton icon={ChevronLeft} label={copy.back} onPress={() => router.back()} />
          }
        />
        <View style={styles.errorWrap}>
          <Banner action={{ label: copy.actions.retry, onPress: () => void s.load(true) }}>
            {s.error ?? copy.threads.notFound}
          </Banner>
        </View>
      </SafeAreaView>
    );
  }

  const closed = outcome.status === 'closed';
  const signal = !closed && outcome.ruleSignal ? signalColors(outcome.ruleSignal, t) : null;
  const headline =
    outcome.agentState === 'pending'
      ? copy.threads.updating
      : (outcome.agentHeadline ?? outcome.ruleNextStep);

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        title={outcome.name}
        meta={closed ? copy.threads.closedGroup : undefined}
        leading={
          <IconButton icon={ChevronLeft} label={copy.back} onPress={() => router.back()} />
        }
        trailing={
          <IconButton
            icon={Ellipsis}
            label={copy.todos.more}
            color={t.fgMuted}
            onPress={() => s.openMenu()}
          />
        }
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headRow}>
          {signal && outcome.ruleSignal ? (
            <View style={[styles.chip, { backgroundColor: signal.bg }]}>
              <Text style={[styles.chipText, { color: signal.fg }]}>
                {copy.today.signal[outcome.ruleSignal]}
              </Text>
            </View>
          ) : null}
          {outcome.createdBy === 'agent' ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{copy.threads.agentBadge}</Text>
            </View>
          ) : null}
        </View>
        {headline !== null ? <Text style={styles.headline}>{headline}</Text> : null}
        {closed ? <Text style={styles.closedNotice}>{copy.threads.closedNotice}</Text> : null}

        <SectionHead
          title={copy.threads.tasksSection}
          count={openTasks.length}
          first
          right={
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => s.toggleCreatingTask()}
            >
              <Text style={styles.sectionAction}>{copy.threads.addTask}</Text>
            </Pressable>
          }
        />
        {s.creatingTask ? (
          <View style={styles.newTaskForm}>
            <Field
              value={s.newTaskTitle}
              onChangeText={(title) => s.setNewTaskTitle(title)}
              placeholder={copy.threads.addTaskPlaceholder}
              maxLength={500}
              autoCapitalize="sentences"
            />
            <View style={styles.newTaskButtons}>
              <Button
                size="sm"
                loading={s.busy}
                disabled={s.newTaskTitle.trim() === ''}
                onPress={() => void s.submitNewTask()}
              >
                {copy.actions.add}
              </Button>
              <Button size="sm" variant="quiet" onPress={() => s.closeCreatingTask()}>
                {copy.actions.cancel}
              </Button>
            </View>
          </View>
        ) : null}
        {openTasks.length === 0 && !s.creatingTask ? (
          <Text style={styles.emptyLine}>{copy.threads.emptyTasks}</Text>
        ) : (
          openTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={(row) => s.toggleTask(row)}
              onPress={(item) => openTask(item.id)}
            />
          ))
        )}
        {doneTasks.length > 0 ? (
          <>
            <SectionHead title={copy.todos.doneGroup} count={doneTasks.length} />
            {doneTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={(row) => s.toggleTask(row)}
                onPress={(item) => openTask(item.id)}
              />
            ))}
          </>
        ) : null}

        <SectionHead
          title={copy.threads.materialsSection}
          count={detail.materials.length}
          right={
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void s.openAttach()}>
              <Text style={styles.sectionAction}>{copy.threads.attach}</Text>
            </Pressable>
          }
        />
        {detail.materials.length === 0 ? (
          <Text style={styles.emptyLine}>{copy.threads.emptyMaterials}</Text>
        ) : (
          detail.materials.map((material) => (
            <Pressable
              key={material.id}
              accessibilityRole="button"
              accessibilityLabel={material.title}
              onPress={() => router.push(`/inbox/${material.id}`)}
              onLongPress={() => s.openMaterialMenu(material)}
              delayLongPress={320}
              style={({ pressed }) => [styles.materialRow, pressed && styles.pressed]}
            >
              <View style={styles.materialBody}>
                <Text style={styles.materialTitle} numberOfLines={1}>
                  {material.title}
                </Text>
                <Text style={styles.materialMeta} numberOfLines={1}>
                  {material.siteName ?? copy.inbox.source[material.source]}
                  {' · '}
                  {relativeTime(material.capturedAt)}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <PickerSheet visible={s.menuOpen} title={outcome.name} onClose={() => s.closeMenu()}>
        <PickerOption icon={Pencil} label={copy.threads.rename} onPress={() => s.openRename()} />
        {closed ? (
          <PickerOption
            icon={RotateCcw}
            label={copy.threads.reopen}
            onPress={() => void s.reopenOutcome()}
          />
        ) : (
          <PickerOption
            icon={Archive}
            label={copy.threads.close}
            onPress={() => void s.closeOutcome()}
          />
        )}
      </PickerSheet>

      <PickerSheet
        visible={menuMaterial !== null}
        title={menuMaterial?.title ?? ''}
        onClose={() => s.closeMaterialMenu()}
      >
        {menuMaterial ? (
          <PickerOption
            icon={Unlink}
            label={copy.threads.detach}
            onPress={() => void s.detach(menuMaterial)}
          />
        ) : null}
      </PickerSheet>

      <BottomSheet visible={s.renaming} onClose={() => s.closeRename()}>
        <View style={styles.form}>
          <Text style={styles.formTitle}>{copy.threads.renameTitle}</Text>
          <Field
            value={s.renameName}
            onChangeText={(name) => s.setRenameName(name)}
            maxLength={120}
            autoCapitalize="sentences"
          />
          <Button
            size="lg"
            loading={s.busy}
            disabled={s.renameName.trim() === ''}
            onPress={() => void s.submitRename()}
          >
            {copy.actions.save}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet visible={s.attaching} onClose={() => s.closeAttach()}>
        <View style={styles.attachWrap}>
          <Text style={styles.formTitle}>{copy.threads.attachTitle}</Text>
          <Field
            value={s.attachSearch}
            onChangeText={(value) => s.setAttachSearch(value)}
            placeholder={copy.threads.attachSearch}
            autoCapitalize="none"
          />
          <ScrollView style={styles.attachList} keyboardShouldPersistTaps="handled">
            {s.attachItems === null ? (
              <Text style={styles.emptyLine}>{copy.loading}</Text>
            ) : attachCandidates.length === 0 ? (
              <Text style={styles.emptyLine}>{copy.threads.attachEmpty}</Text>
            ) : (
              attachCandidates.map((item) => {
                const belongsTo =
                  item.outcomeId !== null ? s.outcomeNames[item.outcomeId] : undefined;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    onPress={() => void s.attach(item)}
                    style={({ pressed }) => [styles.attachRow, pressed && styles.pressed]}
                  >
                    <Text style={styles.materialTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.materialMeta} numberOfLines={1}>
                      {belongsTo
                        ? copy.threads.attachBelongsTo.replace('{name}', belongsTo)
                        : copy.inbox.source[item.source]}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
});

export const ThreadDetail = bindServices(ThreadDetailContent, [ThreadDetailService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    errorWrap: { padding: t.space[4] },
    content: { paddingHorizontal: t.space[4], paddingBottom: t.space[10] },
    pressed: { opacity: 0.7 },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      marginTop: t.space[2],
    },
    chip: {
      height: 24,
      borderRadius: t.radius.pill,
      paddingHorizontal: 10,
      justifyContent: 'center',
    },
    chipText: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
    badge: {
      height: 20,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
      paddingHorizontal: t.space[2],
      justifyContent: 'center',
    },
    badgeText: { fontSize: 11, fontWeight: '600', color: t.accentPrimary },
    headline: {
      marginTop: t.space[2],
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      color: t.fgMuted,
    },
    closedNotice: {
      marginTop: t.space[2],
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textTertiary,
    },
    sectionAction: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: t.accentPrimary },
    newTaskForm: { gap: t.space[2], marginBottom: t.space[2] },
    newTaskButtons: { flexDirection: 'row', gap: t.space[2] },
    emptyLine: {
      paddingHorizontal: t.space[1],
      paddingVertical: t.space[3],
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textTertiary,
    },
    materialRow: {
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[3],
      borderRadius: t.radius.lg,
    },
    materialBody: { gap: 2 },
    materialTitle: { fontSize: 15, lineHeight: 22, fontWeight: '500', color: t.fgPrimary },
    materialMeta: { fontSize: 12, lineHeight: 16, color: t.textTertiary, fontVariant: ['tabular-nums'] },
    form: { padding: t.space[4], gap: t.space[3] },
    formTitle: {
      fontSize: t.type.section.fontSize,
      lineHeight: t.type.section.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
    },
    attachWrap: { flex: 1, padding: t.space[4], gap: t.space[3] },
    attachList: { flex: 1 },
    attachRow: {
      paddingHorizontal: t.space[3],
      paddingVertical: t.space[3],
      gap: 2,
      borderRadius: t.radius.md,
    },
  });
