import { Switch, Text, View } from 'react-native';
import type { NotificationChannel, NotificationPrefs } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { SectionHead } from '../../components/SectionHead';
import { TimeField } from '../../components/TimeField';
import { copy } from '../../lib/copy';
import type { SettingsHomeStyles } from './settings-home-styles';

export function SettingsNotificationsSection({
  t,
  styles,
  prefs,
  capDraft,
  setCapDraft,
  nickname,
  setNickname,
  enabled,
  setEnabled,
  busy,
  meow,
  patchPrefs,
  saveChannel,
  testChannel,
}: {
  t: Theme;
  styles: SettingsHomeStyles;
  prefs: NotificationPrefs;
  capDraft: string;
  setCapDraft: (value: string) => void;
  nickname: string;
  setNickname: (value: string) => void;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  busy: boolean;
  meow: NotificationChannel | undefined;
  patchPrefs: (input: { notifications: NotificationPrefs }) => Promise<void>;
  saveChannel: () => Promise<void>;
  testChannel: () => Promise<void>;
}) {
  return (
    <>
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
                void patchPrefs({ notifications: { ...prefs, taskRemind: v } })
              }
            />
          </View>
          <View style={styles.hairline} />
          <View style={styles.switchRow}>
            <Text style={styles.rowLabel}>{copy.settings.notify.dayRemind}</Text>
            <Switch
              value={prefs.dayRemind}
              trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
              ios_backgroundColor={t.bgSurfaceMuted}
              onValueChange={(v) =>
                void patchPrefs({ notifications: { ...prefs, dayRemind: v } })
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
              onValueChange={(v) => void patchPrefs({ notifications: { ...prefs, taskDue: v } })}
            />
          </View>
          <View style={styles.hairline} />
          <View style={styles.switchRow}>
            <Text style={styles.rowLabel}>{copy.settings.notify.morningBrief}</Text>
            <Switch
              value={prefs.morningBrief}
              trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
              ios_backgroundColor={t.bgSurfaceMuted}
              onValueChange={(v) =>
                void patchPrefs({ notifications: { ...prefs, morningBrief: v } })
              }
            />
          </View>
          <View style={styles.hairline} />
          <View style={styles.switchRow}>
            <Text style={styles.rowLabel}>{copy.settings.notify.meetingPrep}</Text>
            <Switch
              value={prefs.meetingPrep}
              trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
              ios_backgroundColor={t.bgSurfaceMuted}
              onValueChange={(v) =>
                void patchPrefs({ notifications: { ...prefs, meetingPrep: v } })
              }
            />
          </View>
          <View style={styles.hairline} />
          <View style={styles.switchRow}>
            <Text style={styles.rowLabel}>{copy.settings.notify.weeklyObserve}</Text>
            <Switch
              value={prefs.weeklyObserve}
              trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
              ios_backgroundColor={t.bgSurfaceMuted}
              onValueChange={(v) =>
                void patchPrefs({ notifications: { ...prefs, weeklyObserve: v } })
              }
            />
          </View>
          <View style={styles.hairline} />
          <View style={styles.switchRow}>
            <Text style={styles.rowLabel}>{copy.settings.notify.agentErrand}</Text>
            <Switch
              value={prefs.agentErrand}
              trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
              ios_backgroundColor={t.bgSurfaceMuted}
              onValueChange={(v) =>
                void patchPrefs({ notifications: { ...prefs, agentErrand: v } })
              }
            />
          </View>
          <View style={styles.hairline} />
          <View style={styles.switchRow}>
            <Text style={styles.rowLabel}>{copy.settings.notify.scheduleSuggest}</Text>
            <Switch
              value={prefs.scheduleSuggest}
              trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
              ios_backgroundColor={t.bgSurfaceMuted}
              onValueChange={(v) =>
                void patchPrefs({ notifications: { ...prefs, scheduleSuggest: v } })
              }
            />
          </View>
        </View>
        <Text style={styles.subHead}>{copy.settings.notify.scheduleSuggestHint}</Text>
        <TimeField
          label={copy.settings.notify.workHoursStart}
          value={prefs.workHoursStart}
          onChange={(value) => {
            if (value === '' || value >= prefs.workHoursEnd) return;
            void patchPrefs({ notifications: { ...prefs, workHoursStart: value } });
          }}
        />
        <TimeField
          label={copy.settings.notify.workHoursEnd}
          value={prefs.workHoursEnd}
          onChange={(value) => {
            if (value === '' || value <= prefs.workHoursStart) return;
            void patchPrefs({ notifications: { ...prefs, workHoursEnd: value } });
          }}
        />
        <Field
          label={copy.settings.notify.scheduleDayCap}
          value={capDraft}
          keyboardType="number-pad"
          onChangeText={setCapDraft}
          onBlur={() => {
            const next = Number(capDraft.trim());
            if (!Number.isInteger(next) || next < 30 || next > 1440) {
              setCapDraft(String(prefs.scheduleDayCapMinutes));
              return;
            }
            if (next === prefs.scheduleDayCapMinutes) return;
            void patchPrefs({ notifications: { ...prefs, scheduleDayCapMinutes: next } });
          }}
        />
        <TimeField
          label={copy.settings.notify.morningBriefTime}
          value={prefs.morningBriefTime}
          disabled={!prefs.morningBrief}
          onChange={(value) => {
            if (value === '') return;
            void patchPrefs({ notifications: { ...prefs, morningBriefTime: value } });
          }}
        />
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
            void patchPrefs({
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
            void patchPrefs({
              notifications: { ...prefs, quietHoursStart: start, quietHoursEnd: nextEnd },
            });
          }}
        />
        <Text style={styles.subHead}>{copy.settings.notify.nickname}</Text>
        <Field
          label={copy.settings.notify.nickname}
          value={nickname}
          onChangeText={(value) => setNickname(value)}
          autoCapitalize="none"
        />
        <View style={styles.switchRow}>
          <Text style={styles.rowLabel}>{copy.settings.notify.enabled}</Text>
          <Switch
            value={enabled}
            trackColor={{ false: t.bgSurfaceMuted, true: t.accentPrimary }}
            ios_backgroundColor={t.bgSurfaceMuted}
            onValueChange={(value) => setEnabled(value)}
          />
        </View>
        <View style={styles.btnRow}>
          <Button size="sm" loading={busy} disabled={nickname.trim() === ''} onPress={() => void saveChannel()}>
            {copy.settings.notify.saveChannel}
          </Button>
          <Button variant="secondary" size="sm" disabled={!meow} onPress={() => void testChannel()}>
            {copy.settings.notify.test}
          </Button>
        </View>
      </View>
    </>
  );
}
