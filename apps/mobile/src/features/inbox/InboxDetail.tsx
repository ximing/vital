import { useCallback, useMemo } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { Stack, useRouter } from 'expo-router';
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  Copy,
  Ellipsis,
  Link2,
  Paperclip,
  Star,
  Target,
} from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Icon } from '../../ui/icon';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { InboxReader } from '../../components/InboxReader';
import { Loading } from '../../components/Loading';
import { PickerSheet } from '../../components/PickerSheet';
import { useOpenTask } from '../../components/TaskSheetHost';
import { ActionBar } from '../../components/ActionBar';
import { InboxDetailService } from './inbox.service';
import { isFavorite, isUnread, sourceTileColor, tileLetter, relativeTime } from './model';

const InboxDetailContent = observer(function InboxDetailContent({ inboxId }: { inboxId: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const openTask = useOpenTask();
  const s = useService(InboxDetailService);
  useFocusReload(
    useCallback(async () => {
      s.configure(inboxId);
      await s.load();
    }, [s, inboxId]),
  );

  const item = s.item;
  const outcomes = s.outcomes;
  const fontSize = s.fontSize;

  function confirmDelete(): void {
    Alert.alert(copy.inbox.deleteTitle, copy.inbox.deleteBody, [
      { text: copy.actions.cancel, style: 'cancel' },
      {
        text: copy.inbox.delete,
        style: 'destructive',
        onPress: () => {
          void s.remove().then((ok) => {
            if (ok) router.back();
          });
        },
      },
    ]);
  }

  function shareLink(): void {
    if (!item?.originalUrl) return;
    void Share.share({ message: item.originalUrl }).catch(() => undefined);
  }

  if (item === null && s.error === null) return <Loading />;
  if (item === null) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorWrap}>
          <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => void s.load() }}>
            {s.error ?? copy.empty.inboxReader}
          </Banner>
        </View>
      </SafeAreaView>
    );
  }

  const patchable =
    item.status === 'unread' || item.status === 'later' || item.status === 'archived';
  const converted = item.status === 'converted';
  const favorite = isFavorite(item);
  const archived = item.status === 'archived';
  const outcome = outcomes.find((row) => row.id === item.outcomeId) ?? null;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.back}
          onPress={() => router.back()}
          hitSlop={4}
          style={styles.iconBtn}
        >
          <Icon icon={ChevronLeft} size={22} color={t.fgPrimary} />
        </Pressable>
        <Text style={styles.toolbarMeta} numberOfLines={1}>
          {copy.inbox.sourceShort[item.source]}
          {item.siteName ? ` · ${item.siteName}` : ''}
          {` · ${relativeTime(item.capturedAt)}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.inbox.fontSize}
          onPress={() => s.cycleFontSize()}
          hitSlop={4}
          style={styles.iconBtn}
        >
          <Text style={[styles.aa, fontSize !== 'md' && styles.aaActive]}>Aa</Text>
        </Pressable>
        {patchable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={favorite ? copy.inbox.unfavorite : copy.inbox.favorite}
            onPress={() => void s.patch({ status: favorite ? 'unread' : 'later' })}
            hitSlop={4}
            style={styles.iconBtn}
          >
            <Icon
              icon={Star}
              size={22}
              color={favorite ? t.statusFavorite : t.fgPrimary}
              fill={favorite ? t.statusFavorite : 'none'}
            />
          </Pressable>
        ) : null}
        {patchable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={archived ? copy.inbox.unarchive : copy.inbox.archive}
            onPress={() => void s.patch({ status: archived ? 'unread' : 'archived' })}
            hitSlop={4}
            style={styles.iconBtn}
          >
            <Icon
              icon={archived ? ArchiveRestore : Archive}
              size={22}
              color={archived ? t.accentPrimary : t.fgPrimary}
            />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.todos.more}
          onPress={() => s.openMore()}
          hitSlop={4}
          style={styles.iconBtn}
        >
          <Icon icon={Ellipsis} size={22} color={t.fgPrimary} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{item.title}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.tile, { backgroundColor: sourceTileColor(t, item.source) }]}>
            <Text style={styles.tileLetter}>{tileLetter(item)}</Text>
          </View>
          <Text style={styles.metaText} numberOfLines={1}>
            {[copy.inbox.source[item.source], item.byline, item.siteName]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {item.originalUrl ? (
          <View style={styles.linkRow}>
            <Icon icon={Link2} size={14} color={t.accentPrimary} />
            <Text
              style={styles.link}
              numberOfLines={1}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(item.originalUrl ?? '')}
            >
              {item.originalUrl}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.inbox.copyLink}
              onPress={shareLink}
              hitSlop={8}
            >
              <Icon icon={Copy} size={14} color={t.textTertiary} />
            </Pressable>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.outcomeRow, pressed && styles.pressed]}
          onPress={() => s.openOutcomePicker()}
        >
          <Icon icon={Target} size={16} color={outcome ? t.accentPrimary : t.textTertiary} />
          <Text style={[styles.outcomeLabel, outcome !== null && styles.outcomeLabelSet]}>
            {outcome ? outcome.name : copy.inbox.attachOutcome}
          </Text>
        </Pressable>
        <View style={styles.reader}>
          <InboxReader item={item} size={fontSize} />
        </View>
        {item.assets.length > 0 ? (
          <View style={styles.assets}>
            {item.assets.map((asset) => (
              <Pressable
                key={asset.id}
                accessibilityRole="button"
                style={({ pressed }) => [styles.assetRow, pressed && styles.pressed]}
                onPress={() => {
                  if (asset.url) void Linking.openURL(asset.url).catch(() => undefined);
                }}
              >
                <Icon icon={Paperclip} size={16} color={t.fgMuted} />
                <Text style={styles.assetName} numberOfLines={1}>
                  {asset.originalSrc.split('/').pop() ?? asset.mime}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <ActionBar safeBottom>
        {isUnread(item) ? (
          <Button
            variant="quiet"
            onPress={() => void s.patch({ readAt: new Date().toISOString() })}
          >
            {copy.inbox.markRead}
          </Button>
        ) : null}
        <Button loading={s.busy} disabled={converted} onPress={() => void s.convert(openTask)}>
          {converted ? copy.inbox.convertedChip : copy.actions.convert}
        </Button>
      </ActionBar>
      <PickerSheet visible={s.more} title={item.title} onClose={() => s.closeMore()}>
        {item.originalUrl ? (
          <Pressable
            accessibilityRole="button"
            style={styles.option}
            onPress={() => {
              s.closeMore();
              shareLink();
            }}
          >
            <Text style={styles.optionLabel}>{copy.inbox.copyLink}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={styles.option}
          onPress={() => {
            s.closeMore();
            void s.patch({ readAt: item.readAt === null ? new Date().toISOString() : null });
          }}
        >
          <Text style={styles.optionLabel}>
            {item.readAt === null ? copy.inbox.markRead : copy.inbox.markUnread}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.option}
          onPress={() => {
            s.closeMore();
            confirmDelete();
          }}
        >
          <Text style={[styles.optionLabel, styles.optionDanger]}>{copy.inbox.delete}</Text>
        </Pressable>
      </PickerSheet>
      <PickerSheet
        visible={s.outcomePicker}
        title={copy.inbox.attachOutcome}
        onClose={() => s.closeOutcomePicker()}
      >
        {item.outcomeId !== null ? (
          <Pressable
            accessibilityRole="button"
            style={styles.option}
            onPress={() => {
              s.closeOutcomePicker();
              void s.patch({ outcomeId: null });
            }}
          >
            <Text style={styles.optionLabel}>{copy.inbox.noOutcome}</Text>
          </Pressable>
        ) : null}
        {outcomes.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            style={styles.option}
            onPress={() => {
              s.closeOutcomePicker();
              void s.patch({ outcomeId: row.id });
            }}
          >
            <Text
              style={[styles.optionLabel, row.id === item.outcomeId && styles.optionActive]}
              numberOfLines={1}
            >
              {row.name}
            </Text>
          </Pressable>
        ))}
      </PickerSheet>
    </SafeAreaView>
  );
});

export const InboxDetail = bindServices(InboxDetailContent, [InboxDetailService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    errorWrap: { padding: t.space[4] },
    toolbar: {
      height: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[1],
      paddingHorizontal: t.space[2],
    },
    iconBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toolbarMeta: {
      flex: 1,
      minWidth: 0,
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    aa: { fontSize: t.type.section.fontSize, fontWeight: '600', color: t.fgPrimary },
    aaActive: { color: t.accentPrimary },
    content: { paddingHorizontal: t.space[5], paddingBottom: 120 },
    title: {
      fontSize: 22,
      lineHeight: 32,
      fontWeight: '700',
      color: t.fgPrimary,
      marginTop: t.space[2],
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      marginTop: t.space[3],
    },
    tile: {
      width: 20,
      height: 20,
      borderRadius: t.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tileLetter: { color: t.fgOnAccent, fontSize: 11, fontWeight: '700' },
    metaText: { flex: 1, minWidth: 0, fontSize: t.type.meta.fontSize, color: t.fgMuted },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: t.space[2],
    },
    link: { flex: 1, minWidth: 0, fontSize: t.type.meta.fontSize, color: t.accentPrimary },
    outcomeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      marginTop: t.space[3],
    },
    outcomeLabel: { fontSize: t.type.meta.fontSize, color: t.textTertiary },
    outcomeLabelSet: { color: t.accentPrimary, fontWeight: '500' },
    reader: { marginTop: t.space[5] },
    assets: { marginTop: t.space[5], gap: t.space[2] },
    assetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      minHeight: 40,
      borderRadius: t.radius.md,
      backgroundColor: t.bgSurfaceMuted,
      paddingHorizontal: t.space[3],
    },
    assetName: { flex: 1, minWidth: 0, fontSize: t.type.meta.fontSize, color: t.fgMuted },
    pressed: { opacity: 0.7 },
    option: {
      minHeight: t.space[12],
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      justifyContent: 'center',
    },
    optionLabel: { fontSize: 15, lineHeight: 22, color: t.fgPrimary },
    optionActive: { color: t.accentPrimary, fontWeight: '600' },
    optionDanger: { color: t.danger },
  });
