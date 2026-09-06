import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import type { SearchHit } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/use-theme';

function hrefOf(hit: SearchHit): string {
  if (hit.type === 'task') return `/todos/task/${hit.task.id}`;
  if (hit.type === 'inbox') return `/inbox/${hit.inbox.id}`;
  return `/reports/${hit.report.id}`;
}

function titleOf(hit: SearchHit): string {
  if (hit.type === 'task') return hit.task.title;
  if (hit.type === 'inbox') return hit.inbox.title;
  return hit.report.title;
}

function kindOf(hit: SearchHit): string {
  if (hit.type === 'task') return copy.chipTask;
  if (hit.type === 'inbox') return copy.chipInbox;
  return copy.nav.reports;
}

export function SearchHome() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    const trimmed = q.trim();
    if (trimmed === '') {
      setItems(null);
      return;
    }
    setBusy(true);
    try {
      const res = await client.search({ q: trimmed, limit: 20 });
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(humanError(err));
      setItems([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.nav.search }} />
      <Field
        label={copy.fields.search}
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => void run()}
        returnKeyType="search"
        placeholder={copy.empty.search}
      />
      <Button loading={busy} onPress={() => void run()}>
        {copy.nav.search}
      </Button>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {items === null ? (
        <EmptyState title={copy.empty.search} />
      ) : items.length === 0 ? (
        <EmptyState title={copy.empty.searchNone} />
      ) : (
        items.map((hit) => (
          <Pressable
            key={hrefOf(hit)}
            style={styles.row}
            onPress={() => router.push(hrefOf(hit))}
            accessibilityRole="button"
            accessibilityLabel={titleOf(hit)}
          >
            <View>
              <Text style={styles.title}>{titleOf(hit)}</Text>
              <Text style={styles.kind}>{kindOf(hit)}</Text>
            </View>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      minHeight: theme.hit,
      justifyContent: 'center',
      paddingVertical: theme.space[3],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.borderSubtle,
    },
    title: { fontSize: theme.type.body.fontSize, color: theme.fgPrimary },
    kind: { fontSize: theme.type.caption.fontSize, color: theme.fgMuted, marginTop: theme.space[1] },
  });
