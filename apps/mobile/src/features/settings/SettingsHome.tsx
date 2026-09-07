import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { Bell, Palette, SlidersHorizontal, User } from 'lucide-react-native';
import { DEFAULT_NOTIFICATION_PREFS, IMAGE_MIME_TYPES, type NotificationChannel } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { SelectField } from '../../components/SelectField';
import { ThemeToggle } from '../../components/ThemeToggle';
import { TimeField } from '../../components/TimeField';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { toast } from '../../components/toast';
import { useTheme } from '../../theme/use-theme';
import { Icon } from '../../ui/icon';

const TABS = [
  { id: 'account', label: copy.settings.tabs.account, icon: User },
  { id: 'appearance', label: copy.settings.tabs.appearance, icon: Palette },
  { id: 'notifications', label: copy.settings.tabs.notifications, icon: Bell },
  { id: 'prefs', label: copy.settings.tabs.prefs, icon: SlidersHorizontal },
] as const;

type TabId = (typeof TABS)[number]['id'];

const ZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'UTC',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
];

export function SettingsHome() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const [tab, setTab] = useState<TabId>('account');
  const [displayName, setDisplayName] = useState(auth.user?.displayName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [nickname, setNickname] = useState('');
  const [enabled, setEnabled] = useState(true);

  const prefs = auth.user?.notifications ?? DEFAULT_NOTIFICATION_PREFS;
  const meow = channels.find((c) => c.type === 'meow');
  const zones =
    auth.user && !ZONES.includes(auth.user.timezone) ? [auth.user.timezone, ...ZONES] : ZONES;
  const initial = (auth.user?.displayName ?? '?').slice(0, 1);

  const loadChannels = useCallback(async () => {
    try {
      const res = await client.listNotificationChannels();
      setChannels(res.items);
      const hit = res.items.find((c) => c.type === 'meow');
      if (hit) {
        setNickname(hit.config.nickname);
        setEnabled(hit.enabled);
      }
    } catch (err) {
      setError(humanError(err));
    }
  }, []);

  async function saveProfile(): Promise<void> {
    const next = displayName.trim();
    if (next === '') return;
    setBusy(true);
    try {
      const user = await client.updateMe({ displayName: next });
      auth.refreshUser(user);
      toast(copy.toast.saved);
    } catch (err) {
      toast(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  async function patchPrefs(input: {
    timezone?: string;
    weekStartsOn?: 0 | 1;
    notifications?: typeof prefs;
    avatarAttachmentId?: string;
  }): Promise<void> {
    try {
      const user = await client.updateMe(input);
      auth.refreshUser(user);
    } catch (err) {
      toast(humanError(err));
    }
  }

  async function pickAvatar(): Promise<void> {
    if (!auth.user) return;
    try {
      const ImagePicker = await import('expo-image-picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const mime = asset.mimeType ?? 'image/jpeg';
      if (!(IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return;
      const { File } = await import('expo-file-system');
      const size = asset.fileSize ?? new File(asset.uri).size;
      if (!size) return;
      setBusy(true);
      const uploaded = await client.upload({ fileUri: asset.uri, mime, size });
      await client.bindUpload(uploaded.id, { ownerType: 'user', ownerId: auth.user.id });
      setAvatarFailed(false);
      auth.refreshUser(await client.updateMe({ avatarAttachmentId: uploaded.id }));
    } catch (err) {
      toast(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveChannel(): Promise<void> {
    setBusy(true);
    try {
      if (meow) {
        const updated = await client.patchNotificationChannel(meow.id, {
          enabled,
          config: { nickname },
        });
        setChannels((list) => list.map((c) => (c.id === updated.id ? updated : c)));
      } else {
        const created = await client.createNotificationChannel({
          type: 'meow',
          enabled,
          config: { nickname },
        });
        setChannels((list) => [...list, created]);
      }
      toast(copy.toast.saved);
    } catch (err) {
      toast(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: copy.settings.title }} />
      <View style={styles.intro}>
        <Text style={styles.kicker}>{copy.empty.settings}</Text>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => {
                setTab(item.id);
                if (item.id === 'notifications') void loadChannels();
              }}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Icon icon={item.icon} size={16} color={active ? t.fgPrimary : t.fgMuted} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {tab === 'account' ? (
          <View style={styles.block}>
            <View style={styles.identity}>
              <View style={styles.avatar}>
                {auth.user?.avatarUrl && !avatarFailed ? (
                  <Image
                    source={{ uri: auth.user.avatarUrl }}
                    accessibilityLabel={copy.settings.avatarAlt}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <Text style={styles.avatarInitial}>{initial}</Text>
                )}
              </View>
              <View style={styles.identityCopy}>
                <Text style={styles.displayName} numberOfLines={1}>
                  {auth.user?.displayName || copy.settings.tabs.account}
                </Text>
                {auth.user ? (
                  <Text style={styles.hint} numberOfLines={1}>
                    {auth.user.email}
                  </Text>
                ) : null}
                <View style={styles.identityActions}>
                  <Button variant="secondary" loading={busy} onPress={() => void pickAvatar()}>
                    {copy.settings.changeAvatar}
                  </Button>
                  <Button variant="quiet" onPress={() => void auth.logout()}>
                    {copy.auth.logout}
                  </Button>
                </View>
              </View>
            </View>
            <Field
              label={copy.settings.displayName}
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
            />
            <Button loading={busy} onPress={() => void saveProfile()}>
              {copy.settings.saveProfile}
            </Button>
          </View>
        ) : null}
        {tab === 'appearance' ? (
          <View style={styles.block}>
            <Text style={styles.hint}>{copy.theme.hint}</Text>
            <ThemeToggle />
          </View>
        ) : null}
        {tab === 'notifications' ? (
          <View style={styles.block}>
            <Text style={styles.hint}>{copy.settings.notify.hint}</Text>
            <View style={styles.switchRow}>
              <Text style={styles.rowTitle}>{copy.settings.notify.taskRemind}</Text>
              <Switch
                value={prefs.taskRemind}
                onValueChange={(v) => void patchPrefs({ notifications: { ...prefs, taskRemind: v } })}
              />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.rowTitle}>{copy.settings.notify.taskDue}</Text>
              <Switch
                value={prefs.taskDue}
                onValueChange={(v) => void patchPrefs({ notifications: { ...prefs, taskDue: v } })}
              />
            </View>
            <TimeField
              label={copy.settings.notify.allDayTime}
              value={prefs.allDayNotifyTime}
              onChange={(value) => {
                if (value === '') return;
                void patchPrefs({ notifications: { ...prefs, allDayNotifyTime: value } });
              }}
            />
            <TimeField
              label={copy.settings.notify.quietStart}
              value={prefs.quietHoursStart ?? ''}
              clearable
              onChange={(start) => {
                const nextStart = start === '' ? null : start;
                const end = nextStart === null ? null : (prefs.quietHoursEnd ?? '08:00');
                void patchPrefs({ notifications: { ...prefs, quietHoursStart: nextStart, quietHoursEnd: end } });
              }}
            />
            <TimeField
              label={copy.settings.notify.quietEnd}
              value={prefs.quietHoursEnd ?? ''}
              disabled={prefs.quietHoursStart === null}
              clearable
              onChange={(end) => {
                const nextEnd = end === '' ? null : end;
                const start = nextEnd === null ? null : prefs.quietHoursStart;
                void patchPrefs({ notifications: { ...prefs, quietHoursStart: start, quietHoursEnd: nextEnd } });
              }}
            />
            <Text style={styles.section}>{copy.settings.notify.nickname}</Text>
            <Field
              label={copy.settings.notify.nickname}
              value={nickname}
              onChangeText={setNickname}
              autoCapitalize="none"
            />
            <View style={styles.switchRow}>
              <Text style={styles.rowTitle}>{copy.settings.notify.enabled}</Text>
              <Switch value={enabled} onValueChange={setEnabled} />
            </View>
            <Button loading={busy} disabled={nickname.trim() === ''} onPress={() => void saveChannel()}>
              {copy.settings.notify.saveChannel}
            </Button>
            <Button
              variant="secondary"
              disabled={!meow}
              onPress={() =>
                void client
                  .testNotificationChannel(meow!.id)
                  .then(() => toast(copy.settings.notify.testOk))
                  .catch((err) => toast(humanError(err)))
              }
            >
              {copy.settings.notify.test}
            </Button>
          </View>
        ) : null}
        {tab === 'prefs' ? (
          <View style={styles.block}>
            <SelectField
              label={copy.settings.timezone}
              value={auth.user?.timezone ?? 'UTC'}
              options={zones.map((zone) => ({ value: zone, label: zone }))}
              onChange={(timezone) => void patchPrefs({ timezone })}
            />
            <Text style={styles.section}>{copy.settings.weekStartsOn}</Text>
            <View style={styles.chipRow}>
              {(
                [
                  [0, copy.settings.weekSun],
                  [1, copy.settings.weekMon],
                ] as const
              ).map(([value, label]) => {
                const active = (auth.user?.weekStartsOn ?? 1) === value;
                return (
                  <Pressable
                    key={value}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => void patchPrefs({ weekStartsOn: value })}
                  >
                    <Text style={[styles.chipLabel, active && styles.active]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    intro: { paddingHorizontal: t.space[4], paddingTop: t.space[3] },
    kicker: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    tabs: {
      flexDirection: 'row',
      marginHorizontal: t.space[4],
      marginTop: t.space[3],
      gap: t.space[1],
    },
    tab: {
      flex: 1,
      minHeight: t.hit,
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space[1],
      borderRadius: t.radius.md,
      paddingVertical: t.space[1],
    },
    tabActive: { backgroundColor: t.bgAccentSubtle },
    tabLabel: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    tabLabelActive: { color: t.fgPrimary, fontWeight: '600' },
    scroll: { padding: t.space[4], gap: t.space[3], paddingBottom: t.space[10] },
    block: {
      backgroundColor: t.bgSurface,
      borderRadius: t.radius.lg,
      padding: t.space[4],
      gap: t.space[3],
    },
    identity: { flexDirection: 'row', alignItems: 'center', gap: t.space[4] },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      overflow: 'hidden',
      backgroundColor: t.bgAccentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: { fontSize: t.type.title.fontSize, fontWeight: '600', color: t.accentDeep },
    identityCopy: { flex: 1, minWidth: 0, gap: t.space[1] },
    displayName: { fontSize: t.type.title.fontSize, fontWeight: '600', color: t.fgPrimary },
    identityActions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2], marginTop: t.space[1] },
    hint: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    section: {
      fontSize: t.type.meta.fontSize,
      fontWeight: '600',
      color: t.fgMuted,
      marginTop: t.space[2],
    },
    rowTitle: { fontSize: t.type.body.fontSize, color: t.fgPrimary, flex: 1, paddingRight: t.space[3] },
    active: { color: t.fgPrimary, fontWeight: '600' },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: t.hit,
    },
    chipRow: { flexDirection: 'row', gap: t.space[2] },
    chip: {
      minHeight: t.hit,
      paddingHorizontal: t.space[4],
      borderRadius: t.radius.md,
      backgroundColor: t.bgSurfaceMuted,
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: t.bgAccentSubtle },
    chipLabel: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
  });
