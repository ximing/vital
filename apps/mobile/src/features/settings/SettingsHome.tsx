import { useCallback, useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ONBOARDING_CHECKLIST_KEYS } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Activity, Brain, Flame, MessagesSquare } from 'lucide-react-native';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { NavRow } from '../../components/NavRow';
import { PageHeader } from '../../components/PageHeader';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { SectionHead } from '../../components/SectionHead';
import { ThemeToggle } from '../../components/ThemeToggle';
import { TimeField } from '../../components/TimeField';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import { checklistHref, markOnboarding, showChecklist } from '../../lib/onboarding';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import type { LucideIcon } from '../../ui/icon';
import { LlmSection } from './LlmSection';
import { SettingsService } from './settings.service';

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

/**
 * spec §g 我的/设置：PageHeader「我的」+ 内容卡分节（账户/外观/AI/通知/偏好/LLM）。
 * 卡片 = bgElevated + radius.lg + rnShadow + padding 16；NavRow 卡为 padding 0 浮卡。
 * 移动端输入一律 muted 底无描边（Field/TimeField 已是该样式）。
 */
const SettingsHomeContent = observer(function SettingsHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(SettingsService);
  const auth = s.auth;
  const user = auth.user;
  useFocusReload(useCallback(() => s.load(), [s]));

  const prefs = s.prefs;
  const meow = s.meow;
  const zones = user && !ZONES.includes(user.timezone) ? [user.timezone, ...ZONES] : ZONES;
  const initial = (user?.displayName ?? '?').slice(0, 1);
  const checklist = showChecklist(user?.onboarding);
  const profileDirty =
    s.displayName.trim() !== '' && s.displayName.trim() !== (user?.displayName ?? '');
  const weekStartsOn = user?.weekStartsOn ?? 1;
  const timezone = user?.timezone ?? 'UTC';
  const displayName = s.displayName;
  const nickname = s.nickname;
  const enabled = s.enabled;
  const todayExecs = s.todayExecs;
  const busy = s.busy;
  const avatarFailed = s.avatarFailed;
  const error = s.error;
  const prefPicker = s.prefPicker;

  const aiItems: { icon: LucideIcon; label: string; href: string; value?: string }[] = [
    { icon: Flame, label: copy.me.habits, href: '/habits' },
    { icon: MessagesSquare, label: copy.me.threads, href: '/threads' },
    {
      icon: Activity,
      label: copy.me.agentActivity,
      href: '/activity',
      value:
        todayExecs === null
          ? undefined
          : copy.me.activityToday.replace('{n}', String(todayExecs)),
    },
    { icon: Brain, label: copy.me.memory, href: '/memory' },
  ];

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <PageHeader title={copy.nav.me} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={styles.bannerWrap}>
            <Banner tone="error">{error}</Banner>
          </View>
        ) : null}

        {checklist ? (
          <>
            <SectionHead title={copy.checklist.title} first />
            <View style={[styles.card, styles.cardFlush]}>
              {ONBOARDING_CHECKLIST_KEYS.map((key, index) => {
                const done = auth.user?.onboarding[key] === true;
                return (
                  <View key={key}>
                    {index > 0 ? <View style={styles.hairline} /> : null}
                    <Pressable
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.checkRow, pressed && styles.rowPressed]}
                      onPress={() => {
                        if (key === 'openedWeekly') {
                          void markOnboarding(auth.user, auth.refreshUser, { openedWeekly: true });
                        }
                        router.push(checklistHref(key));
                      }}
                    >
                      <Text style={[styles.checkMark, done && styles.checkMarkDone]}>
                        {done ? '✓' : '○'}
                      </Text>
                      <Text style={[styles.checkTitle, done && styles.done]}>
                        {copy.checklist.items[key]}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
            <Button
              variant="quiet"
              size="sm"
              onPress={() => void markOnboarding(auth.user, auth.refreshUser, { dismissed: true })}
            >
              {copy.checklist.dismiss}
            </Button>
          </>
        ) : null}

        <SectionHead title={copy.settings.tabs.account} first={!checklist} />
        <View style={styles.card}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              {auth.user?.avatarUrl && !avatarFailed ? (
                <Image
                  source={{ uri: auth.user.avatarUrl }}
                  accessibilityLabel={copy.settings.avatarAlt}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                  onError={() => s.setAvatarFailed(true)}
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
            </View>
          </View>
          <View style={styles.identityActions}>
            <Button variant="ghost" size="sm" loading={busy} onPress={() => void s.pickAvatar()}>
              {copy.settings.changeAvatar}
            </Button>
            {/* 危险文字钮：Button 无 danger 文本变体（只有描边），按 §g 在本地实现 */}
            <Pressable
              accessibilityRole="button"
              hitSlop={t.space[2]}
              onPress={() => void auth.logout()}
              style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressedSoft]}
            >
              <Text style={styles.logoutLabel}>{copy.auth.logout}</Text>
            </Pressable>
          </View>
          <Field
            label={copy.settings.displayName}
            value={displayName}
            onChangeText={(value) => s.setDisplayName(value)}
            autoCapitalize="words"
          />
          <View style={styles.rowEnd}>
            <Button
              size="sm"
              loading={busy}
              disabled={!profileDirty}
              onPress={() => void s.saveProfile()}
            >
              {copy.settings.saveProfile}
            </Button>
          </View>
        </View>

        <SectionHead title={copy.settings.tabs.appearance} />
        <View style={styles.card}>
          <Text style={styles.hint}>{copy.theme.hint}</Text>
          <ThemeToggle />
        </View>

        <SectionHead title={copy.me.ai} />
        <View style={[styles.card, styles.cardFlush]}>
          {aiItems.map((item, index) => (
            <NavRow
              key={item.href}
              icon={item.icon}
              label={item.label}
              value={item.value}
              divider={index > 0}
              onPress={() => router.push(item.href)}
            />
          ))}
        </View>

        <SectionHead title={copy.settings.tabs.notifications} />
        <View style={styles.card}>
          <Text style={styles.hint}>{copy.settings.notify.hint}</Text>
          <View>
            <View style={styles.switchRow}>
              <Text style={styles.rowLabel}>{copy.settings.notify.taskRemind}</Text>
              <Switch
                value={prefs.taskRemind}
                trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
                ios_backgroundColor={t.bgSurfaceMuted}
                onValueChange={(v) =>
                  void s.patchPrefs({ notifications: { ...prefs, taskRemind: v } })
                }
              />
            </View>
            <View style={styles.hairline} />
            <View style={styles.switchRow}>
              <Text style={styles.rowLabel}>{copy.settings.notify.taskDue}</Text>
              <Switch
                value={prefs.taskDue}
                trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
                ios_backgroundColor={t.bgSurfaceMuted}
                onValueChange={(v) => void s.patchPrefs({ notifications: { ...prefs, taskDue: v } })}
              />
            </View>
          </View>
          <TimeField
            label={copy.settings.notify.allDayTime}
            value={prefs.allDayNotifyTime}
            onChange={(value) => {
              if (value === '') return;
              void s.patchPrefs({ notifications: { ...prefs, allDayNotifyTime: value } });
            }}
          />
          <TimeField
            label={copy.settings.notify.quietStart}
            value={prefs.quietHoursStart ?? ''}
            clearable
            onChange={(start) => {
              const nextStart = start === '' ? null : start;
              const end = nextStart === null ? null : (prefs.quietHoursEnd ?? '08:00');
              void s.patchPrefs({
                notifications: { ...prefs, quietHoursStart: nextStart, quietHoursEnd: end },
              });
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
              void s.patchPrefs({
                notifications: { ...prefs, quietHoursStart: start, quietHoursEnd: nextEnd },
              });
            }}
          />
          <Text style={styles.subHead}>{copy.settings.notify.nickname}</Text>
          <Field
            label={copy.settings.notify.nickname}
            value={nickname}
            onChangeText={(value) => s.setNickname(value)}
            autoCapitalize="none"
          />
          <View style={styles.switchRow}>
            <Text style={styles.rowLabel}>{copy.settings.notify.enabled}</Text>
            <Switch
              value={enabled}
              trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
              ios_backgroundColor={t.bgSurfaceMuted}
              onValueChange={(value) => s.setEnabled(value)}
            />
          </View>
          <View style={styles.btnRow}>
            <Button
              size="sm"
              loading={busy}
              disabled={nickname.trim() === ''}
              onPress={() => void s.saveChannel()}
            >
              {copy.settings.notify.saveChannel}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!meow}
              onPress={() => void s.testChannel()}
            >
              {copy.settings.notify.test}
            </Button>
          </View>
        </View>

        <SectionHead title={copy.settings.tabs.prefs} />
        <View style={[styles.card, styles.cardFlush]}>
          <NavRow
            label={copy.settings.timezone}
            value={timezone}
            onPress={() => s.openPrefPicker('timezone')}
          />
          <NavRow
            label={copy.settings.weekStartsOn}
            value={weekStartsOn === 1 ? copy.settings.weekMon : copy.settings.weekSun}
            divider
            onPress={() => s.openPrefPicker('week')}
          />
        </View>

        <SectionHead title={copy.settings.tabs.llm} />
        <LlmSection />
      </ScrollView>

      <PickerSheet
        visible={prefPicker === 'timezone'}
        title={copy.settings.timezone}
        onClose={() => s.closePrefPicker()}
      >
        {zones.map((zone) => (
          <PickerOption
            key={zone}
            label={zone}
            selected={zone === timezone}
            onPress={() => {
              s.closePrefPicker();
              void s.patchPrefs({ timezone: zone });
            }}
          />
        ))}
      </PickerSheet>
      <PickerSheet
        visible={prefPicker === 'week'}
        title={copy.settings.weekStartsOn}
        onClose={() => s.closePrefPicker()}
      >
        <PickerOption
          label={copy.settings.weekSun}
          selected={weekStartsOn === 0}
          onPress={() => {
            s.closePrefPicker();
            void s.patchPrefs({ weekStartsOn: 0 });
          }}
        />
        <PickerOption
          label={copy.settings.weekMon}
          selected={weekStartsOn === 1}
          onPress={() => {
            s.closePrefPicker();
            void s.patchPrefs({ weekStartsOn: 1 });
          }}
        />
      </PickerSheet>
    </SafeAreaView>
  );
});

export const SettingsHome = bindServices(SettingsHomeContent, [SettingsService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    scroll: { paddingHorizontal: t.space[4], paddingBottom: t.space[6] },
    bannerWrap: { marginTop: t.space[2], marginBottom: t.space[2] },
    card: {
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
      padding: t.space[4],
      gap: t.space[3],
      ...rnShadow(t),
    },
    cardFlush: { padding: 0, gap: 0, overflow: 'hidden' },
    hairline: { height: StyleSheet.hairlineWidth, backgroundColor: t.borderSubtle },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      minHeight: t.space[12],
      paddingHorizontal: t.space[4],
    },
    rowPressed: { backgroundColor: t.bgSurfaceMuted },
    checkMark: { width: t.space[5], fontSize: 15, color: t.textTertiary },
    checkMarkDone: { color: t.statusDone },
    checkTitle: { flex: 1, fontSize: 15, color: t.fgPrimary },
    done: { color: t.fgMuted, textDecorationLine: 'line-through' },
    identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      overflow: 'hidden',
      backgroundColor: t.bgAccentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: { fontSize: 20, fontWeight: '700', color: t.accentPrimary },
    identityCopy: { flex: 1, minWidth: 0, gap: 2 },
    displayName: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: t.fgPrimary },
    identityActions: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
    logoutBtn: { height: 32, justifyContent: 'center', paddingHorizontal: t.space[3] },
    logoutLabel: { fontSize: t.type.meta.fontSize, fontWeight: '500', color: t.danger },
    pressedSoft: { opacity: 0.7 },
    rowEnd: { flexDirection: 'row', justifyContent: 'flex-end' },
    hint: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    subHead: {
      fontSize: t.type.meta.fontSize,
      fontWeight: '600',
      color: t.fgMuted,
      marginTop: t.space[1],
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      minHeight: t.space[12],
    },
    rowLabel: { flex: 1, fontSize: 15, color: t.fgPrimary },
    btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
  });
