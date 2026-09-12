import { useCallback, useMemo } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { Stack, router } from 'expo-router';
import { Brain, ChevronLeft, Ellipsis, Sparkles, Trash2 } from 'lucide-react-native';
import type { AgentMemoryItem, AgentMemoryKind } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import { relativeTime } from '../inbox/model';
import { useTheme } from '../../theme/use-theme';
import { cardStyle, rnShadow } from '../../ui/card';
import { withAlpha } from '../../ui/color';
import { MemoryService } from './memory.service';

/** kind chip 三色：偏好 accent / 模式 doing / 纠正 due（对齐 web KIND_DOT）。 */
function kindColors(kind: AgentMemoryKind, t: Theme): { fg: string; bg: string } {
  if (kind === 'preference') return { fg: t.accentPrimary, bg: t.bgAccentSubtle };
  if (kind === 'pattern') return { fg: t.statusDoing, bg: withAlpha(t.statusDoing, '1F') };
  return { fg: t.statusDueSoon, bg: withAlpha(t.statusDueSoon, '1F') };
}

function scopeText(scope: string[]): string {
  const labels: Record<string, string> = copy.memory.scopes;
  return scope.map((value) => labels[value] ?? value).join(' · ');
}

const MemoryHomeContent = observer(function MemoryHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(MemoryService);
  useFocusReload(useCallback(() => s.reloadFromFocus(), [s]));
  const items = s.items;
  const sorted = s.sorted;
  const menuItem = s.menuItem;

  function confirmDelete(item: AgentMemoryItem): void {
    Alert.alert(copy.memory.deleteTitle, copy.memory.deleteBody, [
      { text: copy.actions.cancel, style: 'cancel' },
      {
        text: copy.memory.delete,
        style: 'destructive',
        onPress: () => void s.remove(item),
      },
    ]);
  }

  if (s.loading) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <Loading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        title={copy.memory.title}
        leading={
          <IconButton icon={ChevronLeft} label={copy.back} onPress={() => router.back()} />
        }
        trailing={
          <IconButton
            icon={Ellipsis}
            label={copy.todos.more}
            color={t.fgMuted}
            onPress={() => s.openPageMenu()}
          />
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={s.refreshing}
            onRefresh={() => void s.load(true)}
            tintColor={t.accentPrimary}
          />
        }
      >
        {s.error !== null && items.length === 0 ? (
          <Banner action={{ label: copy.actions.retry, onPress: () => void s.load(false) }}>{s.error}</Banner>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Brain}
            title={copy.memory.empty}
            action={{ label: copy.memory.distill, onPress: () => void s.distill() }}
          />
        ) : (
          <View style={styles.cardList}>
            {sorted.map((item) => {
              const kind = kindColors(item.kind, t);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={item.content}
                  onLongPress={() => s.openMenu(item)}
                  delayLongPress={320}
                  onPress={() => s.openMenu(item)}
                  style={({ pressed }) => [
                    cardStyle(t),
                    rnShadow(t),
                    styles.card,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.cardHead}>
                    <View style={[styles.chip, { backgroundColor: kind.bg }]}>
                      <Text style={[styles.chipText, { color: kind.fg }]}>
                        {copy.memory.kinds[item.kind]}
                      </Text>
                    </View>
                    <Text style={styles.scope} numberOfLines={1}>
                      {scopeText(item.scope)}
                    </Text>
                    {item.manual ? (
                      <View style={styles.manualBadge}>
                        <Text style={styles.manualBadgeText}>{copy.memory.manual}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.cardContent} numberOfLines={3}>
                    {item.content}
                  </Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {copy.memory.sourceCount.replace('{n}', String(item.sourceCount))}
                    {' · '}
                    {relativeTime(item.updatedAt)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <PickerSheet visible={s.menuOpen} title={copy.memory.title} onClose={() => s.closePageMenu()}>
        <PickerOption
          icon={Sparkles}
          label={copy.memory.distill}
          onPress={() => {
            s.closePageMenu();
            void s.distill();
          }}
        />
      </PickerSheet>

      <PickerSheet
        visible={menuItem !== null}
        title={menuItem?.content ?? ''}
        onClose={() => s.closeMenu()}
      >
        {menuItem ? (
          <PickerOption
            icon={Trash2}
            label={copy.memory.delete}
            destructive
            onPress={() => {
              const item = menuItem;
              s.closeMenu();
              confirmDelete(item);
            }}
          />
        ) : null}
      </PickerSheet>
    </SafeAreaView>
  );
});

export const MemoryHome = bindServices(MemoryHomeContent, [MemoryService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    content: { padding: t.space[4], paddingBottom: t.space[10] },
    pressed: { opacity: 0.7 },
    cardList: { gap: t.space[3] },
    card: { padding: t.space[4], gap: t.space[2] },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
    chip: {
      height: 22,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.space[2],
      justifyContent: 'center',
    },
    chipText: { fontSize: 11, fontWeight: '600' },
    scope: {
      flex: 1,
      minWidth: 0,
      fontSize: 12,
      lineHeight: 16,
      color: t.textTertiary,
    },
    manualBadge: {
      height: 20,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
      paddingHorizontal: t.space[2],
      justifyContent: 'center',
    },
    manualBadgeText: { fontSize: 11, fontWeight: '600', color: t.accentPrimary },
    cardContent: {
      fontSize: t.type.body.fontSize,
      lineHeight: 21,
      color: t.fgPrimary,
    },
    cardMeta: { fontSize: 12, lineHeight: 16, color: t.textTertiary, fontVariant: ['tabular-nums'] },
  });
