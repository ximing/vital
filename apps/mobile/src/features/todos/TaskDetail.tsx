import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import type { Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Loading } from '../../components/Loading';
import { Screen } from '../../components/Screen';
import { toast } from '../../components/toast';
import { toggleComplete } from './complete';

export function TaskDetail({ taskId }: { taskId: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await client.getTask(taskId);
      setTask(next);
      setTitle(next.title);
      setNotes(next.notes);
      setError(null);
    } catch (err) {
      setError(humanError(err));
    }
  }, [taskId]);

  useFocusReload(load);

  if (task === null && error === null) return <Loading />;
  if (task === null) {
    return (
      <Screen scroll>
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: load }}>
          {error ?? copy.empty.upcoming}
        </Banner>
      </Screen>
    );
  }

  async function save(): Promise<void> {
    if (task === null) return;
    setBusy(true);
    try {
      const next = await client.patchTask(task.id, { title: title.trim(), notes });
      setTask(next);
      toast(copy.toast.saved);
    } catch (err) {
      toast(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: task.title }} />
      <Field label={copy.fields.title} value={title} onChangeText={setTitle} autoCapitalize="sentences" />
      <Field
        label={copy.fields.notes}
        value={notes}
        onChangeText={setNotes}
        multiline
        autoCapitalize="sentences"
      />
      <Text style={styles.meta}>
        {copy.priority[task.priority]}
        {task.dueAt ? ` · ${formatDateTime(task.dueAt, task.timezone)}` : ''}
      </Text>
      <View style={styles.actions}>
        <Button loading={busy} loadingText={copy.actions.saving} onPress={() => void save()}>
          {copy.actions.save}
        </Button>
        {task.status !== 'done' ? (
          <Button
            variant="secondary"
            onPress={() =>
              void toggleComplete(task, setTask, { user: auth.user, refreshUser: auth.refreshUser })
            }
          >
            {copy.actions.completed}
          </Button>
        ) : null}
      </View>
    </Screen>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    meta: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    actions: { flexDirection: 'row', gap: t.space[2], flexWrap: 'wrap' },
  });
