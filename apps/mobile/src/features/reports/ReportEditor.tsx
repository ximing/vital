import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ApiError } from '@vital/api-client';
import type { EntityKind } from '@vital/markdown';
import type { Report, ReportEmbeds, SyncHead, TaskStatus } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Loading } from '../../components/Loading';
import { ReportMarkdown } from '../../components/ReportMarkdown';
import { Screen } from '../../components/Screen';
import { toast, UNDO_MS } from '../../components/toast';
import { InsertPicker } from './InsertPicker';

function insertToken(md: string, token: string): string {
  if (md.includes(token)) return md;
  const sep = md === '' || md.endsWith('\n') ? '' : '\n';
  return `${md}${sep}${token}\n`;
}

export function ReportEditor({ reportId }: { reportId: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [bodyMd, setBodyMd] = useState('');
  const [embeds, setEmbeds] = useState<ReportEmbeds>({ tasks: {}, inbox: {} });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insertKind, setInsertKind] = useState<EntityKind | null>(null);
  const savedBody = useRef('');
  const bodyRef = useRef('');
  const reportRef = useRef<Report | null>(null);
  const headRef = useRef<SyncHead | null>(null);
  const completionIds = useRef(new Map<string, string>());

  const applyReport = useCallback((next: Report) => {
    reportRef.current = next;
    bodyRef.current = next.bodyMd;
    savedBody.current = next.bodyMd;
    setReport(next);
    setBodyMd(next.bodyMd);
    setEmbeds(next.embeds);
  }, []);

  const load = useCallback(async () => {
    try {
      const head = await client.syncHead().catch(() => null);
      const prev = headRef.current;
      if (head) headRef.current = head;
      const current = reportRef.current;
      const dirty = current !== null && bodyRef.current !== savedBody.current;

      if (current !== null && prev && head) {
        const taskMoved = head.tasksMaxUpdatedAt !== prev.tasksMaxUpdatedAt;
        const inboxMoved = head.inboxMaxUpdatedAt !== prev.inboxMaxUpdatedAt;
        const reportsMoved = head.reportsMaxUpdatedAt !== prev.reportsMaxUpdatedAt;
        if (taskMoved || inboxMoved) {
          const next = await client.getReportEmbeds(reportId);
          setEmbeds(next.embeds);
          if (next.revision !== current.revision && !dirty) {
            applyReport(await client.getReport(reportId));
          }
        }
        if (reportsMoved && dirty) {
          toast(copy.toast.remoteUpdated);
        }
        if (reportsMoved && !dirty) {
          applyReport(await client.getReport(reportId));
        }
        setError(null);
        return;
      }

      applyReport(await client.getReport(reportId));
      setError(null);
    } catch (err) {
      setError(humanError(err));
    }
  }, [applyReport, reportId]);

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
      const next = await client.patchReport(report.id, { revision: report.revision, bodyMd });
      applyReport(next);
      toast(copy.toast.saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REPORT_REVISION_CONFLICT') {
        toast(copy.toast.revisionConflict);
        applyReport(await client.getReport(reportId));
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
        applyReport(await client.getReport(reportId));
      } else {
        toast(humanError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onToggleTask(id: string, status: TaskStatus): Promise<void> {
    if (status === 'done') {
      const completionId = completionIds.current.get(id);
      if (completionId === undefined) return;
      try {
        await client.uncompleteTask(id, { completionId });
        const next = await client.getReportEmbeds(reportId);
        setEmbeds(next.embeds);
      } catch (err) {
        toast(humanError(err));
      }
      return;
    }
    try {
      const res = await client.completeTask(id);
      completionIds.current.set(id, res.undo.completionId);
      const existing = embeds.tasks[id];
      setEmbeds((prev) => ({
        ...prev,
        tasks: {
          ...prev.tasks,
          [id]: {
            id,
            title: existing?.title ?? copy.chipTask,
            deletedAt: existing?.deletedAt ?? null,
            status: 'done',
          },
        },
      }));
      toast({
        message: copy.actions.completed,
        durationMs: UNDO_MS,
        action: {
          label: copy.actions.undo,
          onPress: () => {
            void onToggleTask(id, 'done');
          },
        },
      });
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
      <Text style={styles.hint}>{copy.empty.reportBody}</Text>
      <ReportMarkdown
        bodyMd={bodyMd}
        embeds={embeds}
        onToggleTask={(id, status) => void onToggleTask(id, status)}
        onOpenInbox={(id) => router.push(`/inbox/${id}`)}
      />
      <Field
        label={copy.fields.markdown}
        value={bodyMd}
        onChangeText={(value) => {
          bodyRef.current = value;
          setBodyMd(value);
        }}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />
      <View style={styles.row}>
        <Button variant="secondary" onPress={() => setInsertKind('task')}>
          {copy.actions.insertTask}
        </Button>
        <Button variant="secondary" onPress={() => setInsertKind('inbox')}>
          {copy.actions.insertInbox}
        </Button>
      </View>
      {insertKind ? (
        <InsertPicker
          kind={insertKind}
          onInsert={(token) => setBodyMd((prev) => insertToken(prev, token))}
          onClose={() => setInsertKind(null)}
        />
      ) : null}
      <View style={styles.row}>
        <Button loading={busy} loadingText={copy.actions.saving} onPress={() => void save()}>
          {copy.actions.save}
        </Button>
        <Button variant="secondary" loading={busy} onPress={() => void fill()}>
          {copy.actions.fill}
        </Button>
      </View>
    </Screen>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    hint: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
  });
