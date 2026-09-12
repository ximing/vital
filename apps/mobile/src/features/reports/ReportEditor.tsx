import { useCallback, useEffect, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { Stack, useRouter } from 'expo-router';
import type { Theme } from '@vital/tokens';
import { Check, ChevronRight, Plus } from 'lucide-react-native';
import { useOpenTask } from '../../components/TaskSheetHost';
import { copy } from '../../lib/copy';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { PickerSheet } from '../../components/PickerSheet';
import { ReportMarkdown } from '../../components/ReportMarkdown';
import { SectionHead } from '../../components/SectionHead';
import { rnShadow } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { InsertPicker } from './InsertPicker';
import { clockTime } from './period-label';
import { ReportActionBar } from './ReportBar';
import { ReportEditorService } from './report-editor.service';

const ReportEditorContent = observer(function ReportEditorContent({
  reportId,
  embedded = false,
}: {
  reportId: string;
  embedded?: boolean;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const openTask = useOpenTask();
  const s = useService(ReportEditorService);
  useEffect(() => {
    s.configure(reportId);
    s.start();
    return () => s.stop();
  }, [s, reportId]);
  useFocusReload(
    useCallback(async () => {
      s.configure(reportId);
      await s.load();
    }, [s, reportId]),
  );

  const report = s.report;
  const error = s.error;
  const review = s.review;
  const embeds = s.embeds;
  const collapsed = s.collapsed;

  if (report === null && error === null) return <Loading />;
  if (report === null) {
    const fail = (
      <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => void s.load() }}>
        {error ?? copy.empty.reports}
      </Banner>
    );
    return embedded ? fail : <SafeAreaView style={styles.flex} edges={['bottom']}>{fail}</SafeAreaView>;
  }

  const notes = s.notes;

  const body = (
    <>
      {error ? (
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => void s.load() }}>
          {error}
        </Banner>
      ) : null}
      {s.saveError ? <Banner tone="error">{s.saveError}</Banner> : null}
      <View style={[styles.paper, rnShadow(t)]}>
        <View style={styles.paperBar} />
        <TextInput
          value={s.draftTitle}
          onChangeText={(next) => s.writeDraft({ title: next })}
          onBlur={() => void s.save()}
          style={styles.paperTitle}
          placeholder={report.title}
          placeholderTextColor={t.textTertiary}
          multiline
        />
        {s.editingBody ? (
          <TextInput
            value={notes}
            onChangeText={(next) => s.writeNotes(next)}
            onBlur={() => {
              s.setEditingBody(false);
              void s.save();
            }}
            style={styles.paperBodyInput}
            placeholder={copy.empty.reportBody}
            placeholderTextColor={t.textTertiary}
            multiline
            autoFocus
            autoCapitalize="sentences"
            autoCorrect
            textAlignVertical="top"
          />
        ) : (
          <Pressable onPress={() => s.setEditingBody(true)} style={styles.paperBodyView}>
            {notes.trim() === '' || embeds === null ? (
              <Text style={styles.paperPlaceholder}>{copy.empty.reportBody}</Text>
            ) : (
              <ReportMarkdown
                bodyMd={notes}
                embeds={embeds}
                onToggleTask={(id, status) => void s.toggleEmbedTask(id, status, openTask)}
                onOpenInbox={(id) => router.push(`/inbox/${id}`)}
              />
            )}
          </Pressable>
        )}
        <View style={styles.insertRow}>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => s.openInsert('task')}
            style={({ pressed }) => [styles.insertBtn, pressed && styles.pressed]}
          >
            <Icon icon={Plus} size={15} color={t.accentPrimary} />
            <Text style={styles.insertLabel}>{copy.actions.insertTask}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => s.openInsert('inbox')}
            style={({ pressed }) => [styles.insertBtn, pressed && styles.pressed]}
          >
            <Icon icon={Plus} size={15} color={t.accentPrimary} />
            <Text style={styles.insertLabel}>{copy.actions.insertInbox}</Text>
          </Pressable>
        </View>
      </View>
      {review ? (
        <View>
          <View>
            <SectionHead
              title={copy.reports.completed}
              count={review.completed.length}
              collapsible
              collapsed={collapsed.completed}
              onToggle={() => s.toggleSection('completed')}
              first
            />
            {collapsed.completed ? null : (
              <View style={styles.sectionBody}>
                {review.completed.length === 0 ? (
                  <Text style={styles.hint}>{copy.reports.emptyDone}</Text>
                ) : (
                  review.completed.map((item) => (
                    <View key={`${item.taskId}-${item.completionId ?? ''}`} style={styles.reviewRow}>
                      <Icon icon={Check} size={14} color={t.statusDone} />
                      <Text style={styles.reviewTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {item.completedAt ? (
                        <Text style={styles.rowTime}>{clockTime(item.completedAt)}</Text>
                      ) : null}
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
          <View>
            <SectionHead
              title={copy.reports.carried}
              count={review.carried.length}
              collapsible
              collapsed={collapsed.carried}
              onToggle={() => s.toggleSection('carried')}
              first
            />
            {collapsed.carried ? null : (
              <View style={styles.sectionBody}>
                {review.carried.length === 0 ? (
                  <Text style={styles.hint}>{copy.reports.emptyCarried}</Text>
                ) : (
                  review.carried.map((item) => {
                    const done = item.status === 'done' || item.deleted;
                    return (
                      <Pressable
                        key={item.taskId}
                        onPress={() => void s.toggleReviewTask(item)}
                        style={({ pressed }) => [styles.reviewRow, pressed && styles.rowPressed]}
                      >
                        <View style={[styles.checkbox, done && styles.checkboxDone]}>
                          {done ? <Icon icon={Check} size={13} color={t.fgOnAccent} /> : null}
                        </View>
                        <Text
                          style={[styles.reviewTitle, done && styles.reviewTitleDone]}
                          numberOfLines={1}
                        >
                          {item.title}
                        </Text>
                        {item.status === 'done' && item.completedAt ? (
                          <Text style={styles.rowMeta}>{copy.reports.finishedLater}</Text>
                        ) : null}
                        {item.deleted ? <Text style={styles.rowMeta}>{copy.reports.deleted}</Text> : null}
                      </Pressable>
                    );
                  })
                )}
              </View>
            )}
          </View>
          <View>
            <SectionHead
              title={copy.reports.captured}
              count={review.captured.length}
              collapsible
              collapsed={collapsed.captured}
              onToggle={() => s.toggleSection('captured')}
              first
            />
            {collapsed.captured ? null : (
              <View style={styles.sectionBody}>
                {review.captured.length === 0 ? (
                  <Text style={styles.hint}>{copy.reports.emptyCaptured}</Text>
                ) : (
                  review.captured.map((item) => (
                    <Pressable
                      key={item.inboxId}
                      onPress={() => router.push(`/inbox/${item.inboxId}`)}
                      style={({ pressed }) => [styles.reviewRow, pressed && styles.rowPressed]}
                    >
                      <View style={styles.srcDot} />
                      <Text style={styles.reviewTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Icon icon={ChevronRight} size={16} color={t.textTertiary} />
                    </Pressable>
                  ))
                )}
              </View>
            )}
          </View>
        </View>
      ) : null}
      {s.insertKind ? (
        <InsertPicker
          kind={s.insertKind}
          onInsert={(token) => s.insert(token)}
          onClose={() => s.closeInsert()}
        />
      ) : null}
      <PickerSheet
        visible={s.conflict}
        title={copy.reports.conflict}
        onClose={() => void s.resolveConflict('keep')}
      >
        <Text style={styles.conflictHint}>{copy.reports.conflictHint}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void s.resolveConflict('reload')}
          style={({ pressed }) => [styles.optionRow, pressed && styles.rowPressed]}
        >
          <Text style={styles.optionLabel}>{copy.reports.reload}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void s.resolveConflict('keep')}
          style={({ pressed }) => [styles.optionRow, pressed && styles.rowPressed]}
        >
          <Text style={styles.optionLabel}>{copy.reports.keepLocal}</Text>
        </Pressable>
      </PickerSheet>
    </>
  );

  if (embedded) return <View style={styles.embed}>{body}</View>;
  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <Stack.Screen options={{ title: report.title }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.standaloneScroll}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
        <ReportActionBar
          state={s.barState}
          onFill={() => void s.fill()}
          onGenerate={() => void s.generate()}
          onSave={() => void s.save()}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});

export const ReportEditor = bindServices(ReportEditorContent, [ReportEditorService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    embed: { gap: t.space[3] },
    standaloneScroll: { padding: t.space[4], gap: t.space[3], paddingBottom: t.space[8] },
    sectionBody: { gap: t.space[1], paddingHorizontal: t.space[1] },
    hint: {
      fontSize: t.type.meta.fontSize,
      color: t.textTertiary,
      paddingVertical: t.space[2],
    },
    reviewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      paddingVertical: t.space[2],
      paddingHorizontal: t.space[2],
      borderRadius: t.radius.lg,
    },
    rowPressed: { backgroundColor: t.bgSurfaceMuted },
    reviewTitle: { flex: 1, fontSize: 15, lineHeight: 22, color: t.fgPrimary },
    reviewTitleDone: { color: t.fgMuted, textDecorationLine: 'line-through' },
    rowTime: {
      fontSize: t.type.caption.fontSize,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    rowMeta: { fontSize: t.type.caption.fontSize, color: t.textTertiary },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: t.textTertiary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxDone: { backgroundColor: t.statusDone, borderColor: t.statusDone },
    srcDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.accentPrimary },
    paper: {
      marginTop: t.space[3],
      borderRadius: t.radius.xl,
      backgroundColor: t.bgElevated,
      borderWidth: 1,
      borderColor: t.borderSubtle,
      padding: t.space[5],
      gap: t.space[3],
    },
    paperBar: {
      width: 44,
      height: 3,
      borderRadius: 2,
      backgroundColor: t.accentPrimary,
    },
    paperTitle: {
      fontSize: t.type.title.fontSize,
      lineHeight: t.type.title.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
      padding: 0,
    },
    paperBodyInput: {
      minHeight: 252,
      fontSize: t.type.body.fontSize,
      lineHeight: 24.5,
      color: t.fgPrimary,
      padding: 0,
    },
    paperBodyView: { minHeight: 252 },
    paperPlaceholder: {
      fontSize: t.type.body.fontSize,
      lineHeight: 24.5,
      color: t.textTertiary,
    },
    insertRow: {
      flexDirection: 'row',
      gap: t.space[5],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borderSubtle,
      paddingTop: 10,
    },
    insertBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[1],
      height: t.space[8],
      borderRadius: t.radius.md,
    },
    insertLabel: { fontSize: t.type.meta.fontSize, fontWeight: '500', color: t.accentPrimary },
    pressed: { opacity: 0.7 },
    conflictHint: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.fgMuted,
      marginBottom: t.space[2],
    },
    optionRow: {
      height: t.space[12],
      justifyContent: 'center',
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[2],
    },
    optionLabel: { fontSize: 15, lineHeight: 22, color: t.fgPrimary },
  });
