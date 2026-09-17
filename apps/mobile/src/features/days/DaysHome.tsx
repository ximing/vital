import { useCallback, useEffect, useMemo } from 'react';
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { Stack, router } from 'expo-router';
import { CalendarDays, ChevronLeft, Plus } from 'lucide-react-native';
import type { Day, DayCatalogKind, DayReminderOffset } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { IconButton } from '../../components/IconButton';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { DaysService } from './days.service';

function headlineText(day: Day): string {
  if (day.headline.kind === 'today') return copy.days.today;
  if (day.headline.kind === 'countdown') return copy.days.countdown.replace('{n}', String(day.headline.days));
  return copy.days.countup.replace('{n}', String(day.headline.days));
}

const OFFSETS: { value: DayReminderOffset; label: string }[] = [
  { value: 0, label: copy.days.reminderOnDay },
  { value: 1, label: copy.days.reminder1 },
  { value: 3, label: copy.days.reminder3 },
  { value: 7, label: copy.days.reminder7 },
  { value: 30, label: copy.days.reminder30 },
];

const DaysHomeContent = observer(function DaysHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(DaysService);
  useEffect(() => {
    void s.load();
  }, [s]);
  useFocusReload(useCallback(() => s.load(), [s]));

  const draft = s.draft;
  const weekStartsOn = s.auth.user?.weekStartsOn === 0 ? 0 : 1;
  const heroes = s.items.filter((day) => day.pinned).slice(0, 2);
  const rest = s.items.filter((day) => !heroes.some((hero) => hero.id === day.id));

  function confirmDelete(day: Day): void {
    Alert.alert(copy.days.deleteTitle, copy.days.deleteBody, [
      { text: copy.actions.cancel, style: 'cancel' },
      { text: copy.days.delete, style: 'destructive', onPress: () => void s.remove(day) },
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
        title={copy.days.title}
        leading={<IconButton icon={ChevronLeft} label={copy.back} onPress={() => router.back()} />}
        trailing={
          <View style={styles.headerActions}>
            <IconButton icon={CalendarDays} label={copy.days.catalog} onPress={() => s.openCatalog()} />
            <IconButton icon={Plus} label={copy.days.add} onPress={() => s.openCreate()} />
          </View>
        }
      />
      {s.error ? (
        <View style={styles.pad}>
          <Banner tone="error">{s.error}</Banner>
          <Button onPress={() => void s.load()}>{copy.days.retry}</Button>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => void s.load()} tintColor={t.accentPrimary} />
        }
      >
        {s.items.length === 0 ? (
          <EmptyState title={copy.days.emptyTitle} hint={copy.days.emptyHint} />
        ) : (
          <>
            {heroes.map((day) => (
              <Pressable key={day.id} onPress={() => s.openEdit(day)} style={[styles.hero, rnShadow(t)]}>
                <Image source={{ uri: day.coverUrl }} style={styles.heroImg} />
                <View style={styles.heroBody}>
                  <Text style={styles.rowName}>{day.name}</Text>
                  <Text style={styles.heroCount}>{headlineText(day)}</Text>
                  <Text style={styles.rowMeta}>{day.solarLabel}</Text>
                </View>
              </Pressable>
            ))}
            {rest.map((day) => (
              <Pressable key={day.id} onPress={() => s.openEdit(day)} style={[styles.row, rnShadow(t)]}>
                <Image source={{ uri: day.coverUrl }} style={styles.thumb} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowName}>{day.name}</Text>
                  <Text style={styles.rowCount}>{headlineText(day)}</Text>
                  <Text style={styles.rowMeta}>{day.solarLabel}</Text>
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      <BottomSheet visible={draft !== null} onClose={() => s.closeDraft()}>
        {draft ? (
          <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>{draft.id ? copy.days.edit : copy.days.creating}</Text>
            <Field label={copy.days.name} value={draft.name} onChangeText={(name) => s.patchDraft({ name })} />
            <SelectField
              label={copy.days.calendar}
              value={draft.calendar}
              options={[
                { value: 'solar', label: copy.days.solar },
                { value: 'lunar', label: copy.days.lunar },
              ]}
              onChange={(calendar) => s.patchDraft({ calendar })}
            />
            {draft.calendar === 'solar' ? (
              <DateField
                label={copy.days.date}
                value={draft.anchorYmd}
                kind="date"
                zone={s.zone}
                weekStartsOn={weekStartsOn}
                onChange={(anchorYmd) => s.patchDraft({ anchorYmd: anchorYmd.slice(0, 10) })}
              />
            ) : (
              <>
                <Field
                  label={copy.days.lunarYear}
                  value={String(draft.lunarYear)}
                  keyboardType="number-pad"
                  onChangeText={(value) => s.patchDraft({ lunarYear: Number(value.replaceAll(/[^0-9]/g, '')) || draft.lunarYear })}
                />
                <Field
                  label={copy.days.lunarMonth}
                  value={String(draft.lunarMonth)}
                  keyboardType="number-pad"
                  onChangeText={(value) =>
                    s.patchDraft({ lunarMonth: Math.min(12, Math.max(1, Number(value) || 1)) })
                  }
                />
                <Field
                  label={copy.days.lunarDay}
                  value={String(draft.lunarDay)}
                  keyboardType="number-pad"
                  onChangeText={(value) =>
                    s.patchDraft({ lunarDay: Math.min(30, Math.max(1, Number(value) || 1)) })
                  }
                />
              </>
            )}
            <SelectField
              label={copy.days.repeat}
              value={draft.repeat}
              options={[
                { value: 'none', label: copy.days.repeatNone },
                { value: 'yearly', label: copy.days.repeatYearly },
              ]}
              onChange={(repeat) => s.patchDraft({ repeat })}
            />
            <SelectField
              label={copy.days.display}
              value={draft.displayMode}
              options={[
                { value: 'auto', label: copy.days.displayAuto },
                { value: 'countdown', label: copy.days.displayCountdown },
                { value: 'countup', label: copy.days.displayCountup },
              ]}
              onChange={(displayMode) => s.patchDraft({ displayMode })}
            />
            <Field label={copy.days.note} value={draft.note} onChangeText={(note) => s.patchDraft({ note })} />
            <Button onPress={() => void s.pickCover()}>{copy.days.uploadCover}</Button>
            <Text style={styles.legend}>{copy.days.reminder}</Text>
            {OFFSETS.map((item) => (
              <View key={item.value} style={styles.switchRow}>
                <Text style={styles.switchLabel}>{item.label}</Text>
                <Switch
                  value={draft.reminderOffsets.includes(item.value)}
                  onValueChange={() => s.toggleOffset(item.value)}
                  trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
                />
              </View>
            ))}
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{copy.days.pin}</Text>
              <Switch
                value={draft.pinned}
                onValueChange={(pinned) => s.patchDraft({ pinned })}
                trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
              />
            </View>
            {s.formError ? <Text style={styles.err}>{s.formError}</Text> : null}
            <Button onPress={() => void s.saveDraft()} disabled={s.saving}>
              {copy.days.save}
            </Button>
            {s.editing?.source === 'statutory' ? (
              <Button variant="ghost" onPress={() => void s.hide(s.editing!)}>
                {copy.days.hide}
              </Button>
            ) : null}
            {s.editing?.canDelete ? (
              <Button variant="danger" onPress={() => confirmDelete(s.editing!)}>
                {copy.days.delete}
              </Button>
            ) : null}
          </ScrollView>
        ) : null}
      </BottomSheet>

      <BottomSheet visible={s.catalogOpen} onClose={() => s.closeCatalog()}>
        <ScrollView contentContainerStyle={styles.sheet}>
          <Text style={styles.sheetTitle}>{copy.days.catalog}</Text>
          {(['statutory', 'traditional', 'international'] as DayCatalogKind[]).map((kind) => {
            const items = s.catalog.filter((item) => item.kind === kind);
            if (items.length === 0) return null;
            const title =
              kind === 'statutory'
                ? copy.days.catalogStatutory
                : kind === 'traditional'
                  ? copy.days.catalogTraditional
                  : copy.days.catalogInternational;
            return (
              <View key={kind}>
                <Text style={styles.legend}>{title}</Text>
                {items.map((item) => (
                  <View key={item.key} style={styles.catalogRow}>
                    <Text style={styles.rowName}>{item.name}</Text>
                    {item.added ? (
                      <Text style={styles.rowMeta}>{copy.days.catalogAdded}</Text>
                    ) : (
                      <Button onPress={() => void s.addCatalog(item.key)}>
                        {item.hidden ? copy.days.catalogShow : copy.days.catalogAdd}
                      </Button>
                    )}
                  </View>
                ))}
              </View>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  );
});

export const DaysHome = bindServices(DaysHomeContent, [DaysService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    pad: { padding: t.space[4], gap: t.space[3] },
    content: { padding: t.space[4], paddingBottom: t.space[10], gap: t.space[3] },
    headerActions: { flexDirection: 'row' },
    hero: { borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.bgElevated },
    heroImg: { width: '100%', height: 180 },
    heroBody: { padding: t.space[4], gap: 2 },
    heroCount: {
      color: t.fgPrimary,
      fontSize: 26,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    row: {
      flexDirection: 'row',
      backgroundColor: t.bgElevated,
      borderRadius: t.radius.lg,
      overflow: 'hidden',
    },
    thumb: { width: 120, height: 80 },
    rowBody: { flex: 1, justifyContent: 'center', paddingHorizontal: t.space[3], gap: 2 },
    rowName: { color: t.fgPrimary, fontWeight: '600', fontSize: 15 },
    rowCount: { color: t.fgPrimary, fontWeight: '700', fontVariant: ['tabular-nums'] },
    rowMeta: { color: t.fgMuted, fontSize: 12 },
    sheet: { padding: t.space[4], gap: t.space[3], paddingBottom: t.space[10] },
    sheetTitle: { ...t.type.title, color: t.fgPrimary },
    legend: { color: t.fgMuted, fontSize: 13, marginTop: t.space[2] },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
    },
    switchLabel: { color: t.fgPrimary, fontSize: 15 },
    err: { color: t.danger },
    catalogRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 48,
      gap: t.space[3],
    },
  });
