import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CreateTaskInput, Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { toast } from '../../components/toast';

export function NewTaskBar({
  listId,
  extra,
  onCreated,
}: {
  listId: string;
  extra?: Partial<CreateTaskInput>;
  onCreated: (task: Task) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    try {
      const task = await client.createTask({ title: trimmed, listId, ...extra });
      setTitle('');
      onCreated(task);
    } catch (err) {
      toast(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Field
          placeholder={copy.actions.create}
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
        />
      </View>
      <Button loading={busy} onPress={() => void submit()}>
        {copy.actions.add}
      </Button>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: t.space[2],
      paddingHorizontal: t.space[4],
      paddingBottom: t.space[2],
    },
    field: { flex: 1 },
  });
