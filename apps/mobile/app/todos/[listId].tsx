import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { ListId } from '@vital/dto';
import { listIdSchema } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { RequireAuth } from '../../src/components/RequireAuth';
import { Screen } from '../../src/components/Screen';
import { Banner } from '../../src/components/Banner';
import { TaskList } from '../../src/features/todos/TaskList';
import { copy } from '../../src/lib/copy';
import { useTheme } from '../../src/theme/use-theme';

function emptyCopy(listId: string): string {
  if (listId === 'smart:today') return copy.empty.today;
  if (listId === 'smart:done') return copy.empty.done;
  if (listId === 'smart:inbox') return copy.empty.inboxList;
  if (listId.startsWith('smart:')) return copy.empty.upcoming;
  return copy.empty.userList;
}

function titleCopy(listId: string): string {
  if (listId === 'smart:today') return copy.lists.today;
  if (listId === 'smart:inbox') return copy.lists.inbox;
  if (listId === 'smart:upcoming') return copy.lists.upcoming;
  if (listId === 'smart:anytime') return copy.lists.anytime;
  if (listId === 'smart:someday') return copy.lists.someday;
  if (listId === 'smart:done') return copy.lists.done;
  return copy.nav.todos;
}

export default function TodoListScreen() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const params = useLocalSearchParams<{ listId: string }>();
  const raw = typeof params.listId === 'string' ? decodeURIComponent(params.listId) : '';
  const parsed = listIdSchema.safeParse(raw);
  const listId: ListId | null = parsed.success ? parsed.data : null;

  return (
    <RequireAuth>
      {listId === null ? (
        <Screen>
          <Banner tone="error">{copy.empty.upcoming}</Banner>
        </Screen>
      ) : (
        <View style={styles.flex}>
          <Stack.Screen options={{ title: titleCopy(listId) }} />
          <TaskList
            listId={listId}
            empty={emptyCopy(listId)}
            createListId={listId.startsWith('smart:') ? undefined : listId}
          />
        </View>
      )}
    </RequireAuth>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
  });
