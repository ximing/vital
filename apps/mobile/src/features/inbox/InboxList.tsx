import { useCallback, useEffect, useMemo } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { Plus, Star } from 'lucide-react-native';
import type { InboxItem } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { Banner } from '../../components/Banner';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonBox } from '../../components/Skeleton';
import { PickerSheet } from '../../components/PickerSheet';
import { SearchIconButton } from '../../components/SearchIconButton';
import { SectionHead } from '../../components/SectionHead';
import { useOpenTask } from '../../components/TaskSheetHost';
import { InboxCompose } from './InboxCompose';
import { InboxService } from './inbox.service';
import {
  groupByDay,
  isFavorite,
  isUnread,
  sourceTileColor,
  tileLetter,
  relativeTime,
  type InboxFilter,
} from './model';

const InboxListContent = observer(function InboxListContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const s = useService(InboxService);
  const openTask = useOpenTask();
  const tz = s.tz;
  useEffect(() => {
    s.start();
    return () => s.stop();
  }, [s]);
  useFocusReload(useCallback(() => s.reloadFromFocus(), [s]));

  function confirmDelete(item: InboxItem): void {
    Alert.alert(copy.inbox.deleteTitle, copy.inbox.deleteBody, [
      { text: copy.actions.cancel, style: 'cancel' },
      { text: copy.inbox.delete, style: 'destructive', onPress: () => void s.remove(item) },
    ]);
  }

  function shareLink(item: InboxItem): void {
    if (!item.originalUrl) return;
    void Share.share({ message: item.originalUrl }).catch(() => undefined);
  }

  const filter = s.filter;
  const filters: { key: InboxFilter; label: string; count?: number }[] = [
    { key: 'all', label: copy.inbox.filterAll },
    { key: 'unread', label: copy.inbox.filterUnread, count: s.unread },
    { key: 'favorite', label: copy.inbox.filterFavorite },
    { key: 'archived', label: copy.inbox.filterArchived },
  ];

  if (s.loading && s.items.length === 0) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {copy.nav.inbox}
          </Text>
          <SearchIconButton />
        </View>
        <View style={styles.skeletonList} accessibilityElementsHidden importantForAccessibility="no">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.card, rnShadow(t)]}>
              <View style={styles.cardHead}>
                <SkeletonBox width={24} height={24} radius={t.radius.sm} />
                <SkeletonBox height={15} style={styles.skeletonTitle} />
              </View>
              <SkeletonBox width="100%" height={13} style={styles.skeletonLine} />
              <SkeletonBox width="72%" height={13} style={styles.skeletonLine} />
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  const visible = s.visible;
  const groups = groupByDay(visible, tz);

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {copy.nav.inbox}
        </Text>
        <SearchIconButton />
      </View>
      {s.offline ? <Banner tone="info">{copy.offline}</Banner> : null}
      {s.error ? (
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => void s.load(true) }}>
          {s.error}
        </Banner>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsBar}
        contentContainerStyle={styles.chips}
      >
        {filters.map((chip) => {
          const active = filter === chip.key;
          return (
            <Pressable
              key={chip.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => s.setFilter(chip.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{chip.label}</Text>
              {chip.count !== undefined && chip.count > 0 ? (
                <Text style={[styles.chipCount, active && styles.chipLabelActive]}>
                  {chip.count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
      <SectionList
        sections={groups.map((group) => ({
          title: group.title,
          count: group.items.length,
          data: group.items,
        }))}
        keyExtractor={(row) => row.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            tintColor={t.accentPrimary}
            refreshing={s.refreshing}
            onRefresh={() => void s.load(true)}
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHead}>
            <SectionHead title={section.title} count={section.count} />
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            title={copy.empty.inbox}
            action={
              filter === 'all'
                ? { label: copy.actions.create, onPress: () => s.openCompose() }
                : undefined
            }
          />
        }
        ListFooterComponent={
          s.nextCursor !== null ? (
            <Button
              variant="secondary"
              loading={s.loadingMore}
              style={styles.loadMore}
              onPress={() => void s.loadMore()}
            >
              {copy.actions.loadMore}
            </Button>
          ) : null
        }
        renderItem={({ item }) => {
          const unread = isUnread(item);
          return (
            <Pressable
              style={({ pressed }) => [styles.card, rnShadow(t), pressed && styles.cardPressed]}
              onPress={() => {
                if (unread) s.markRead(item);
                router.push(`/inbox/${item.id}`);
              }}
              onLongPress={() => s.openMenu(item)}
              accessibilityRole="button"
              accessibilityLabel={item.title}
            >
              <View style={styles.cardHead}>
                <View style={[styles.tile, { backgroundColor: sourceTileColor(t, item.source) }]}>
                  <Text style={styles.tileLetter}>{tileLetter(item)}</Text>
                </View>
                <Text style={[styles.cardTitle, !unread && styles.cardTitleRead]} numberOfLines={1}>
                  {item.title}
                </Text>
                {unread ? <View style={styles.unreadDot} /> : null}
              </View>
              {item.excerpt ? (
                <Text style={styles.excerpt} numberOfLines={2}>
                  {item.excerpt}
                </Text>
              ) : null}
              <View style={styles.metaRow}>
                <Text style={styles.meta}>
                  {copy.inbox.sourceShort[item.source]}
                  {item.siteName ? ` · ${item.siteName}` : ''}
                  {` · ${relativeTime(item.capturedAt)}`}
                </Text>
                <View style={styles.metaSpacer} />
                {isFavorite(item) ? (
                  <Icon icon={Star} size={14} color={t.statusFavorite} fill={t.statusFavorite} />
                ) : null}
                {item.status === 'converted' ? (
                  <View style={styles.convertedChip}>
                    <Text style={styles.convertedLabel}>{copy.inbox.convertedChip}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.actions.create}
        onPress={() => s.openCompose()}
        style={({ pressed }) => [
          styles.fab,
          { bottom: Math.max(insets.bottom, 20) + 48 + 16 },
          pressed && styles.fabPressed,
        ]}
      >
        <Icon icon={Plus} size={26} color={t.fgOnAccent} strokeWidth={2.2} />
      </Pressable>
      <BottomSheet visible={s.compose} onClose={() => s.closeCompose()}>
        <InboxCompose onClose={() => s.closeCompose()} />
      </BottomSheet>
      <PickerSheet
        visible={s.menuItem !== null}
        title={s.menuItem?.title ?? ''}
        onClose={() => s.closeMenu()}
      >
        {s.menuItem ? (
          <View>
            <Pressable
              accessibilityRole="button"
              style={styles.option}
              onPress={() => {
                const item = s.menuItem;
                s.closeMenu();
                if (item === null) return;
                if (isUnread(item)) s.markRead(item);
                router.push(`/inbox/${item.id}`);
              }}
            >
              <Text style={styles.optionLabel}>{copy.inbox.open}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.option}
              onPress={() => {
                const item = s.menuItem;
                s.closeMenu();
                if (item === null) return;
                void s.applyPatch(item.id, {
                  readAt: item.readAt === null ? new Date().toISOString() : null,
                });
              }}
            >
              <Text style={styles.optionLabel}>
                {s.menuItem.readAt === null ? copy.inbox.markRead : copy.inbox.markUnread}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.option}
              onPress={() => {
                const item = s.menuItem;
                s.closeMenu();
                if (item === null) return;
                void s.applyPatch(item.id, { status: isFavorite(item) ? 'unread' : 'later' });
              }}
            >
              <Text style={styles.optionLabel}>
                {isFavorite(s.menuItem) ? copy.inbox.unfavorite : copy.inbox.favorite}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.option}
              onPress={() => {
                const item = s.menuItem;
                s.closeMenu();
                if (item === null) return;
                void s.applyPatch(item.id, {
                  status: item.status === 'archived' ? 'unread' : 'archived',
                });
              }}
            >
              <Text style={styles.optionLabel}>
                {s.menuItem.status === 'archived' ? copy.inbox.unarchive : copy.inbox.archive}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.option}
              onPress={() => {
                const item = s.menuItem;
                s.closeMenu();
                if (item === null) return;
                void s.convert(item, openTask);
              }}
            >
              <Text style={styles.optionLabel}>{copy.actions.convert}</Text>
            </Pressable>
            {s.menuItem.originalUrl ? (
              <Pressable
                accessibilityRole="button"
                style={styles.option}
                onPress={() => {
                  const item = s.menuItem;
                  s.closeMenu();
                  if (item === null) return;
                  shareLink(item);
                }}
              >
                <Text style={styles.optionLabel}>{copy.inbox.copyLink}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={styles.option}
              onPress={() => {
                const item = s.menuItem;
                s.closeMenu();
                if (item === null) return;
                confirmDelete(item);
              }}
            >
              <Text style={[styles.optionLabel, styles.optionDanger]}>{copy.inbox.delete}</Text>
            </Pressable>
          </View>
        ) : null}
      </PickerSheet>
    </SafeAreaView>
  );
});

export const InboxList = bindServices(InboxListContent, [InboxService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    header: {
      height: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      paddingHorizontal: t.space[4],
      marginBottom: t.space[2],
    },
    headerTitle: {
      flex: 1,
      minWidth: 0,
      fontSize: t.type.display.fontSize,
      lineHeight: t.type.display.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
    },
    chipsBar: { flexGrow: 0, marginBottom: t.space[1] },
    chips: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[1],
    },
    chip: {
      height: 32,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.borderSubtle,
      backgroundColor: t.bgElevated,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    chipActive: { backgroundColor: t.bgAccentSubtle, borderColor: 'transparent' },
    chipLabel: { fontSize: t.type.meta.fontSize, lineHeight: t.type.meta.lineHeight, fontWeight: '500', color: t.fgMuted },
    chipLabelActive: { color: t.accentPrimary, fontWeight: '600' },
    chipCount: {
      fontSize: t.type.caption.fontSize,
      color: t.fgMuted,
      fontVariant: ['tabular-nums'],
    },
    list: { paddingHorizontal: t.space[4], paddingBottom: 96 },
    skeletonList: { paddingHorizontal: t.space[4], paddingTop: t.space[2] },
    skeletonTitle: { flex: 1, minWidth: 0 },
    skeletonLine: { marginTop: 6 },
    sectionHead: { paddingHorizontal: t.space[1] },
    card: {
      backgroundColor: t.bgElevated,
      borderRadius: t.radius.lg,
      paddingHorizontal: t.space[4],
      paddingTop: 14,
      paddingBottom: t.space[3],
      marginBottom: t.space[3],
    },
    cardPressed: { opacity: 0.7 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    tile: {
      width: 24,
      height: 24,
      borderRadius: t.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tileLetter: { color: t.fgOnAccent, fontSize: t.type.caption.fontSize, fontWeight: '700' },
    cardTitle: {
      flex: 1,
      minWidth: 0,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    cardTitleRead: { color: t.fgMuted },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.accentPrimary,
    },
    excerpt: {
      marginTop: 6,
      fontSize: t.type.meta.fontSize,
      lineHeight: 19,
      color: t.fgMuted,
    },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: t.space[2], marginTop: t.space[2] },
    meta: {
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    metaSpacer: { flex: 1 },
    convertedChip: {
      height: 20,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
      paddingHorizontal: t.space[2],
      alignItems: 'center',
      justifyContent: 'center',
    },
    convertedLabel: { fontSize: 11, fontWeight: '600', color: t.accentPrimary },
    loadMore: { alignSelf: 'center', marginTop: t.space[2], marginBottom: t.space[4] },
    fab: {
      position: 'absolute',
      right: t.space[5],
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.accentPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      ...rnShadow(t),
      shadowRadius: 12,
    },
    fabPressed: { backgroundColor: t.accentPrimaryHover },
    option: {
      minHeight: t.space[12],
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      justifyContent: 'center',
    },
    optionLabel: { fontSize: 15, lineHeight: 22, color: t.fgPrimary },
    optionDanger: { color: t.danger },
  });
