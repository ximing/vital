import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { renderToken, type EntityKind } from '@vital/markdown';
import type { Theme } from '@vital/tokens';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { toast } from '../../components/toast';

export function InsertPicker({
  kind,
  onInsert,
  onClose,
}: {
  kind: EntityKind;
  onInsert: (token: `[[${EntityKind}:${string}]]`) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function search(): Promise<void> {
    const trimmed = q.trim();
    if (trimmed === '') return;
    setBusy(true);
    try {
      const res = await client.search({ q: trimmed, types: [kind] });
      const next: { id: string; title: string }[] = [];
      for (const hit of res.items) {
        if (hit.type === 'task' && kind === 'task') {
          next.push({ id: hit.task.id, title: hit.task.title });
        }
        if (hit.type === 'inbox' && kind === 'inbox') {
          next.push({ id: hit.inbox.id, title: hit.inbox.title });
        }
      }
      setHits(next);
    } catch (err) {
      toast(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.sheet}>
      <Text style={styles.title}>
        {kind === 'task' ? copy.actions.insertTask : copy.actions.insertInbox}
      </Text>
      <Field
        label={copy.fields.search}
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => void search()}
        returnKeyType="search"
      />
      <Button loading={busy} onPress={() => void search()}>
        {copy.nav.search}
      </Button>
      {hits.map((hit) => (
        <Pressable
          key={hit.id}
          style={styles.hit}
          onPress={() => {
            onInsert(renderToken(kind, hit.id));
            onClose();
          }}
        >
          <Text style={styles.hitTitle}>{hit.title}</Text>
        </Pressable>
      ))}
      <Button variant="quiet" onPress={onClose}>
        {copy.actions.cancel}
      </Button>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    sheet: {
      gap: t.space[2],
      padding: t.space[4],
      backgroundColor: t.bgSurface,
      borderRadius: t.radius.lg,
    },
    title: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.fgPrimary },
    hit: {
      paddingVertical: t.space[3],
      minHeight: t.hit,
      justifyContent: 'center',
    },
    hitTitle: { fontSize: t.type.body.fontSize, color: t.fgPrimary },
  });
