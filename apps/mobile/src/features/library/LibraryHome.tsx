import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { List } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { TabHeader } from '../../components/TabHeader';
import { ThemeToggle } from '../../components/ThemeToggle';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';

const SMART_ORDER = [
  'smart:today',
  'smart:inbox',
  'smart:upcoming',
  'smart:anytime',
  'smart:someday',
  'smart:done',
] as const;

function listLabel(list: List): string {
  if (list.id === 'smart:today') return copy.lists.today;
  if (list.id === 'smart:inbox') return copy.lists.inbox;
  if (list.id === 'smart:upcoming') return copy.lists.upcoming;
  if (list.id === 'smart:anytime') return copy.lists.anytime;
  if (list.id === 'smart:someday') return copy.lists.someday;
  if (list.id === 'smart:done') return copy.lists.done;
  return list.name;
}

export function LibraryHome() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const [lists, setLists] = useState<List[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await client.syncHead().catch(() => undefined);
      const res = await client.listLists();
      setLists(res.items);
      setError(null);
    } catch (err) {
      setError(humanError(err));
    }
  }, []);

  useFocusReload(load);

  const smart = SMART_ORDER.map((id) => lists.find((row) => row.id === id)).filter(
    (row): row is List => row !== undefined,
  );
  const userLists = lists.filter((row) => row.kind === 'user' && !row.isArchived);
  const inboxList = lists.find((row) => row.kind === 'inbox');

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <TabHeader title={copy.nav.library} />
      {error ? (
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: load }}>
          {error}
        </Banner>
      ) : null}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>{copy.nav.todos}</Text>
        {[...smart, ...(inboxList && !smart.some((s) => s.id === inboxList.id) ? [inboxList] : [])].map(
          (list) => (
            <Pressable
              key={list.id}
              style={styles.row}
              onPress={() => router.push(`/todos/${encodeURIComponent(list.id)}`)}
            >
              <Text style={styles.rowTitle}>{listLabel(list)}</Text>
            </Pressable>
          ),
        )}
        {userLists.map((list) => (
          <Pressable
            key={list.id}
            style={styles.row}
            onPress={() => router.push(`/todos/${encodeURIComponent(list.id)}`)}
          >
            <Text style={styles.rowTitle}>{list.name}</Text>
          </Pressable>
        ))}
        <Text style={styles.section}>{copy.theme.label}</Text>
        <Text style={styles.hint}>{copy.theme.hint}</Text>
        <ThemeToggle />
        {auth.user ? <Text style={styles.hint}>{auth.user.email}</Text> : null}
        <Button variant="danger" onPress={() => void auth.logout()}>
          {copy.auth.logout}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    scroll: { padding: t.space[4], gap: t.space[3] },
    section: {
      fontSize: t.type.meta.fontSize,
      fontWeight: '600',
      color: t.fgMuted,
      marginTop: t.space[2],
    },
    row: {
      minHeight: t.hit,
      justifyContent: 'center',
      paddingVertical: t.space[3],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borderSubtle,
    },
    rowTitle: { fontSize: t.type.body.fontSize, color: t.fgPrimary },
    hint: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
  });
