import { useCallback, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import type { InboxItem, List } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { InboxReader } from '../../components/InboxReader';
import { Loading } from '../../components/Loading';
import { Screen } from '../../components/Screen';
import { toast } from '../../components/toast';

export function InboxDetail({ inboxId }: { inboxId: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const [item, setItem] = useState<InboxItem | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [next, listRes] = await Promise.all([client.getInbox(inboxId), client.listLists()]);
      setItem(next);
      setLists(listRes.items);
      setError(null);
    } catch (err) {
      setError(humanError(err));
    }
  }, [inboxId]);

  useFocusReload(load);

  if (item === null && error === null) return <Loading />;
  if (item === null) {
    return (
      <Screen scroll>
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: load }}>
          {error ?? copy.empty.inboxReader}
        </Banner>
      </Screen>
    );
  }

  async function convert(): Promise<void> {
    if (item === null) return;
    setBusy(true);
    try {
      const inboxList = lists.find((row) => row.kind === 'inbox');
      const res = await client.convertInbox(
        item.id,
        inboxList ? { listId: inboxList.id } : {},
      );
      toast(copy.toast.converted);
      router.push(`/todos/task/${res.task.id}`);
    } catch (err) {
      toast(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: item.title }} />
      <Text style={styles.kicker}>
        {copy.inbox.source[item.source]}
        {item.siteName ? ` · ${item.siteName}` : ''}
        {item.byline ? ` · ${item.byline}` : ''}
      </Text>
      {item.originalUrl ? (
        <Button variant="quiet" onPress={() => void Linking.openURL(item.originalUrl ?? '')}>
          {item.originalUrl}
        </Button>
      ) : null}
      <InboxReader item={item} />
      <Button loading={busy} onPress={() => void convert()}>
        {copy.actions.convert}
      </Button>
    </Screen>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    kicker: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
  });
