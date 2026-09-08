import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ApiError } from '@vital/api-client';
import type { EntityKind } from '@vital/markdown';
import {
  extractNotes,
  replaceNotes,
  type Report,
  type ReportCarriedTask,
  type ReportReview,
  type SyncHead,
} from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { client } from '../../lib/api';
import { subscribeSync } from '../../lib/sync';
import { copy } from '../../lib/copy';
import { markOnboarding } from '../../lib/onboarding';
import { humanError } from '../../lib/errors';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Loading } from '../../components/Loading';
import { Screen } from '../../components/Screen';
import { toast } from '../../components/toast';
import { InsertPicker } from './InsertPicker';
import { insertToken, runReportFocusSync } from './report-sync';

export function ReportEditor({ reportId }: { reportId: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [bodyMd, setBodyMd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insertKind, setInsertKind] = useState<EntityKind | null>(null);
  const [review, setReview] = useState<ReportReview | null>(null);
  const savedBody = useRef('');
  const bodyRef = useRef('');
  const reportRef = useRef<Report | null>(null);
  const headRef = useRef<SyncHead | null>(null);

  const applyReport = useCallback((next: Report) => {
    reportRef.current = next;
    bodyRef.current = next.bodyMd;
    savedBody.current = next.bodyMd;
    setReport(next);
    setBodyMd(next.bodyMd);
  }, []);

  const writeBody = useCallback((next: string) => {
    bodyRef.current = next;
    setBodyMd(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const current = reportRef.current;
      const dirty = current !== null && bodyRef.current !== savedBody.current;
      const result = await runReportFocusSync(
        {
          syncHead: () => client.syncHead(),
          getReport: (id) => client.getReport(id),
          getEmbeds: (id) => client.getReportEmbeds(id),
        },
        {
          reportId,
          hasReport: current !== null,
          dirty,
          prevHead: headRef.current,
        },
      );
      if (result.head !== null) headRef.current = result.head;
      if (result.report !== undefined) {
        if (bodyRef.current !== savedBody.current) return;
        applyReport(result.report);
      }
      if (result.toastRemote) toast(copy.toast.remoteUpdated);
      const nextReview = await client.getReportReview(reportId);
      setReview(nextReview);
      setError(null);
    } catch (err) {
      setError(humanError(err));
    }
  }, [applyReport, reportId]);

  useEffect(() => {
    return subscribeSync((changes) => {
      const mine = changes.reports.some((row) => row.id === reportId);
      if (!mine && changes.tasks.length === 0 && changes.inbox.length === 0) return;
      void load();
    });
  }, [load, reportId]);

  useFocusReload(load);

  if (report === null && error === null) return <Loading />;
  if (report === null) {
    return (
      <Screen scroll>
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: load }}>
          {error ?? copy.empty.reports}
        </Banner>
      </Screen>
    );
  }

  async function save(): Promise<void> {
    if (report === null) return;
    setBusy(true);
    try {
      const next = await client.patchReport(report.id, {
        revision: report.revision,
        bodyMd: bodyRef.current,
      });
      applyReport(next);
      toast(copy.toast.saved);
      if (next.type === 'daily') {
        await markOnboarding(auth.user, auth.refreshUser, { wroteDaily: true });
      }
      if (next.type === 'weekly') {
        await markOnboarding(auth.user, auth.refreshUser, { openedWeekly: true });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REPORT_REVISION_CONFLICT') {
        toast(copy.toast.revisionConflict);
      } else {
        toast(humanError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function fill(): Promise<void> {
    if (report === null) return;
    setBusy(true);
    try {
      const next = await client.fillReport(report.id, { revision: report.revision });
      applyReport(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REPORT_REVISION_CONFLICT') {
        toast(copy.toast.revisionConflict);
      } else {
        toast(humanError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleReviewTask(item: ReportCarriedTask): Promise<void> {
    try {
      if (item.completionId) {
        await client.uncompleteTask(item.taskId, { completionId: item.completionId });
      } else {
        await client.completeTask(item.taskId);
      }
      const nextReview = await client.getReportReview(reportId);
      setReview(nextReview);
    } catch (err) {
      toast(humanError(err));
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: report.title }} />
      {error ? (
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: load }}>
          {error}
        </Banner>
      ) : null}
      {review ? (
        <View style={styles.review}>
          <Text style={styles.metaLine}>
            {copy.reports.completed} {review.completed.length}
            {'  '}
            {copy.reports.carried} {review.carried.length}
            {'  '}
            {copy.reports.captured} {review.captured.length}
          </Text>
          {review.completed.length === 0 && review.carried.length === 0 && review.captured.length === 0 ? (
            <Text style={styles.hint}>{copy.reports.emptyDone}</Text>
          ) : (
            <>
              {review.completed.map((item) => (
                <Text key={`${item.taskId}-${item.completionId ?? ''}`} style={styles.doneItem}>
                  {item.title}
                </Text>
              ))}
              {review.carried.map((item) => (
                <Pressable
                  key={item.taskId}
                  onPress={() => void toggleReviewTask(item)}
                  style={styles.carry}
                >
                  <Text
                    style={[
                      styles.carryTitle,
                      (item.status === 'done' || item.deleted) && styles.doneItem,
                    ]}
                  >
                    {item.title}
                    {item.status === 'done' && item.completedAt
                      ? ` · ${copy.reports.finishedLater}`
                      : ''}
                    {item.deleted ? ` · ${copy.reports.deleted}` : ''}
                  </Text>
                </Pressable>
              ))}
              {review.captured.map((item) => (
                <Pressable key={item.inboxId} onPress={() => router.push(`/inbox/${item.inboxId}`)}>
                  <Text style={styles.carryTitle}>{item.title}</Text>
                </Pressable>
              ))}
            </>
          )}
        </View>
      ) : null}
      <Text style={styles.writeLabel}>{copy.reports.write}</Text>
      <Field
        value={report ? extractNotes(bodyMd, report.type) : ''}
        onChangeText={(next) => {
          if (!report) return;
          writeBody(replaceNotes(bodyRef.current, report.type, next));
        }}
        multiline
        autoCapitalize="sentences"
        autoCorrect
        placeholder={copy.empty.reportBody}
      />
      <View style={styles.row}>
        <Button variant="quiet" onPress={() => setInsertKind('task')}>
          {copy.actions.insertTask}
        </Button>
        <Button variant="quiet" onPress={() => setInsertKind('inbox')}>
          {copy.actions.insertInbox}
        </Button>
      </View>
      {insertKind ? (
        <InsertPicker
          kind={insertKind}
          onInsert={(token) => writeBody(insertToken(bodyRef.current, token))}
          onClose={() => setInsertKind(null)}
        />
      ) : null}
      <View style={styles.row}>
        <Button loading={busy} loadingText={copy.actions.saving} onPress={() => void save()}>
          {copy.actions.save}
        </Button>
        <Button variant="quiet" loading={busy} onPress={() => void fill()}>
          {copy.actions.fill}
        </Button>
      </View>
    </Screen>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    hint: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    writeLabel: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    metaLine: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    review: { gap: t.space[2] },
    doneItem: {
      fontSize: t.type.body.fontSize,
      color: t.fgMuted,
      textDecorationLine: 'line-through',
    },
    carry: { paddingVertical: t.space[2] },
    carryTitle: { fontSize: t.type.body.fontSize, color: t.fgPrimary },
  });
