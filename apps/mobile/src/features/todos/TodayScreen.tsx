import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { startOfLocalDayIso } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { TabHeader } from '../../components/TabHeader';
import { useTheme } from '../../theme/use-theme';
import { TaskList } from './TaskList';

export function TodayScreen() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const tz = auth.user?.timezone ?? 'UTC';

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <TabHeader title={copy.nav.today} />
      <TaskList
        listId="smart:today"
        empty={copy.empty.today}
        createFromInbox
        createExtra={{ dueAt: startOfLocalDayIso(tz), isAllDay: true, timezone: tz }}
      />
    </SafeAreaView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
  });
