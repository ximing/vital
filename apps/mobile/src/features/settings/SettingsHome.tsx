import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  DEFAULT_DAILY_MODEL_CALL_LIMIT,
  MAX_DAILY_MODEL_CALL_LIMIT,
  MIN_DAILY_MODEL_CALL_LIMIT,
  ONBOARDING_CHECKLIST_KEYS,
} from '@vital/dto';
import { ScanLine } from 'lucide-react-native';
import { Banner } from '../../components/Banner';
import { IconButton } from '../../components/IconButton';
import { PageHeader } from '../../components/PageHeader';
import { SectionHead } from '../../components/SectionHead';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { copy } from '../../lib/copy';
import { checklistHref, markOnboarding, showChecklist } from '../../lib/onboarding';
import { useTheme } from '../../theme/use-theme';
import { LlmSection } from './LlmSection';
import { InwitSection } from './InwitSection';
import { QrLoginScanner } from './QrLoginScanner';
import { QrLoginScanService } from './qr-login.service';
import { SettingsAboutSection } from './SettingsAboutSection';
import { SettingsAccountSection } from './SettingsAccountSection';
import { SettingsAiSection } from './SettingsAiSection';
import { SettingsAppearanceSection } from './SettingsAppearanceSection';
import { SettingsChecklist } from './SettingsChecklist';
import { SettingsNotificationsSection } from './SettingsNotificationsSection';
import { SettingsPrefSheets, SettingsPrefsSection } from './SettingsPrefsSection';
import { createSettingsHomeStyles } from './settings-home-styles';
import { SettingsService } from './settings.service';
import { openPhoneCalendarAccess } from '../today/phone-calendar';

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
  const styles = useMemo(() => createSettingsHomeStyles(t), [t]);
  const s = useService(SettingsService);
  const scan = useService(QrLoginScanService);
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
  const savedLimit = user?.dailyModelCallLimit ?? DEFAULT_DAILY_MODEL_CALL_LIMIT;
  const [limitDraft, setLimitDraft] = useState(String(savedLimit));
  const [limitError, setLimitError] = useState('');
  const [syncedLimit, setSyncedLimit] = useState(savedLimit);
  const capSaved = prefs?.scheduleDayCapMinutes ?? 540;
  const [capDraft, setCapDraft] = useState(String(capSaved));
  const [capSeen, setCapSeen] = useState(capSaved);
  if (capSaved !== capSeen) {
    setCapSeen(capSaved);
    setCapDraft(String(capSaved));
  }
  if (savedLimit !== syncedLimit) {
    setSyncedLimit(savedLimit);
    setLimitDraft(String(savedLimit));
    setLimitError('');
  }
  function commitLimit(raw: string) {
    const next = Number(raw.trim());
    if (
      !Number.isInteger(next) ||
      next < MIN_DAILY_MODEL_CALL_LIMIT ||
      next > MAX_DAILY_MODEL_CALL_LIMIT
    ) {
      setLimitError(
        copy.settings.dailyModelCallLimitInvalid
          .replace('{min}', String(MIN_DAILY_MODEL_CALL_LIMIT))
          .replace('{max}', String(MAX_DAILY_MODEL_CALL_LIMIT)),
      );
      return;
    }
    setLimitError('');
    setLimitDraft(String(next));
    if (next !== savedLimit) void s.patchPrefs({ dailyModelCallLimit: next });
  }
  const displayName = s.displayName;
  const nickname = s.nickname;
  const enabled = s.enabled;
  const todayExecs = s.todayExecs;
  const busy = s.busy;
  const avatarFailed = s.avatarFailed;
  const error = s.error;
  const prefPicker = s.prefPicker;
  const update = s.update;
  const updatePhase = update.phase;
  const updateBytes = update.bytesDownloaded;
  const updateTotal = update.totalBytes;
  const updateNotes = update.remote?.releaseNotes;
  const versionName = update.current.versionName;
  const avatarUrl = user?.avatarUrl;
  const profileName = user?.displayName;
  const email = user?.email;
  const checklistRows = checklist
    ? ONBOARDING_CHECKLIST_KEYS.map((key) => ({
        key,
        done: user?.onboarding[key] === true,
        label: copy.checklist.items[key],
      }))
    : [];

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <PageHeader
        title={copy.nav.me}
        trailing={
          <IconButton icon={ScanLine} label={copy.me.scanLogin} onPress={() => scan.show()} />
        }
      />
      {scan.open ? <QrLoginScanner /> : null}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={styles.bannerWrap}>
            <Banner tone="error">{error}</Banner>
          </View>
        ) : null}

        {checklist ? (
          <SettingsChecklist
            styles={styles}
            rows={checklistRows}
            onOpen={(key) => {
              if (key === 'openedWeekly') {
                void markOnboarding(auth.user, auth.refreshUser, { openedWeekly: true });
              }
              router.push(checklistHref(key));
            }}
            onDismiss={() => void markOnboarding(auth.user, auth.refreshUser, { dismissed: true })}
          />
        ) : null}

        <SettingsAccountSection
          t={t}
          styles={styles}
          first={!checklist}
          avatarUrl={avatarUrl}
          avatarFailed={avatarFailed}
          onAvatarError={() => s.setAvatarFailed(true)}
          initial={initial}
          profileName={profileName}
          email={email}
          hasUser={user != null}
          displayName={displayName}
          onDisplayName={(value) => s.setDisplayName(value)}
          busy={busy}
          profileDirty={profileDirty}
          onPickAvatar={() => void s.pickAvatar()}
          onLogout={() => void auth.logout()}
          onSaveProfile={() => void s.saveProfile()}
        />

        <SettingsAppearanceSection styles={styles} />

        <SettingsAiSection
          styles={styles}
          todayExecs={todayExecs}
          onOpen={(href) => router.push(href)}
        />

        <SettingsNotificationsSection
          t={t}
          styles={styles}
          prefs={prefs}
          capDraft={capDraft}
          setCapDraft={setCapDraft}
          nickname={nickname}
          setNickname={(value) => s.setNickname(value)}
          enabled={enabled}
          setEnabled={(value) => s.setEnabled(value)}
          busy={busy}
          meow={meow}
          patchPrefs={(input) => s.patchPrefs(input)}
          saveChannel={() => s.saveChannel()}
          testChannel={() => s.testChannel()}
        />

        <SettingsPrefsSection
          styles={styles}
          timezone={timezone}
          weekStartsOn={weekStartsOn}
          limitDraft={limitDraft}
          limitError={limitError}
          setLimitDraft={setLimitDraft}
          setLimitError={setLimitError}
          commitLimit={commitLimit}
          onOpenTimezone={() => s.openPrefPicker('timezone')}
          onOpenWeek={() => s.openPrefPicker('week')}
          onOpenCalendar={() => void openPhoneCalendarAccess()}
        />

        <SectionHead title={copy.settings.tabs.llm} />
        <LlmSection />

        <SectionHead title={copy.settings.tabs.inwit} />
        <InwitSection />

        <SettingsAboutSection
          styles={styles}
          updatePhase={updatePhase}
          updateBytes={updateBytes}
          updateTotal={updateTotal}
          updateNotes={updateNotes}
          versionName={versionName}
          onPressPrimary={() => update.pressPrimary()}
          onInstall={() => update.install()}
        />
      </ScrollView>

      <SettingsPrefSheets
        prefPicker={prefPicker}
        zones={zones}
        timezone={timezone}
        weekStartsOn={weekStartsOn}
        onClose={() => s.closePrefPicker()}
        patchPrefs={(input) => s.patchPrefs(input)}
      />
    </SafeAreaView>
  );
});

export const SettingsHome = bindServices(SettingsHomeContent, [
  SettingsService,
  QrLoginScanService,
]);
