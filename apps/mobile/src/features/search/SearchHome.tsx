import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { SearchHit } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { useOpenTask } from '../../components/TaskSheetHost';
import { SearchService } from './search.service';

function hrefOf(hit: SearchHit): string {
  if (hit.type === 'task') return `task:${hit.task.id}`;
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

const SearchHomeContent = observer(function SearchHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const openTask = useOpenTask();
  const s = useService(SearchService);
  useEffect(() => () => s.stop(), [s]);

  return (
    <Screen>
      <Stack.Screen options={{ title: copy.nav.search }} />
      <View style={styles.body}>
        <Field
          value={s.q}
          onChangeText={(q) => s.setQuery(q)}
          returnKeyType="search"
          placeholder={copy.empty.search}
          accessibilityLabel={copy.nav.search}
        />
        {s.busy ? <ActivityIndicator color={t.accentPrimary} /> : null}
        {s.error ? <Banner tone="error">{s.error}</Banner> : null}
        <ScrollView
          style={styles.results}
          contentContainerStyle={styles.resultsContent}
          keyboardShouldPersistTaps="handled"
        >
          {s.items === null ? (
            <EmptyState title={copy.empty.search} />
          ) : s.items.length === 0 ? (
            <EmptyState title={copy.empty.searchNone} />
          ) : (
            s.items.map((hit) => (
              <Pressable
                key={hrefOf(hit)}
                style={styles.row}
                onPress={() => {
                  if (hit.type === 'task') openTask(hit.task.id);
                  else router.push(hrefOf(hit));
                }}
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
        </ScrollView>
      </View>
    </Screen>
  );
});

export const SearchHome = bindServices(SearchHomeContent, [SearchService]);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    body: {
      flex: 1,
      paddingHorizontal: theme.space[4],
      paddingTop: theme.space[2],
    },
    results: { flex: 1, marginTop: theme.space[2] },
    resultsContent: { paddingBottom: theme.space[6], gap: theme.space[1] },
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
