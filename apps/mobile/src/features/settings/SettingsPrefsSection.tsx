import { Text, View } from 'react-native';
import {
  DEFAULT_DAILY_MODEL_CALL_LIMIT,
  type NotificationPrefs,
} from '@vital/dto';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { NavRow } from '../../components/NavRow';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { SectionHead } from '../../components/SectionHead';
import { copy } from '../../lib/copy';
import type { SettingsHomeStyles } from './settings-home-styles';

type PrefsPatch = {
  timezone?: string;
  weekStartsOn?: 0 | 1;
  dailyModelCallLimit?: number;
  notifications?: NotificationPrefs;
};

export function SettingsPrefsSection({
  styles,
  timezone,
  weekStartsOn,
  limitDraft,
  limitError,
  setLimitDraft,
  setLimitError,
  commitLimit,
  onOpenTimezone,
  onOpenWeek,
  onOpenCalendar,
}: {
  styles: SettingsHomeStyles;
  timezone: string;
  weekStartsOn: 0 | 1;
  limitDraft: string;
  limitError: string;
  setLimitDraft: (value: string) => void;
  setLimitError: (value: string) => void;
  commitLimit: (raw: string) => void;
  onOpenTimezone: () => void;
  onOpenWeek: () => void;
  onOpenCalendar: () => void;
}) {
  return (
    <>
      <SectionHead title={copy.settings.tabs.prefs} />
      <View style={[styles.card, styles.cardFlush]}>
        <NavRow label={copy.settings.timezone} value={timezone} onPress={onOpenTimezone} />
        <NavRow
          label={copy.settings.weekStartsOn}
          value={weekStartsOn === 1 ? copy.settings.weekMon : copy.settings.weekSun}
          divider
          onPress={onOpenWeek}
        />
        <View style={styles.hairline} />
        <View style={styles.limitPad}>
          <Text style={styles.calendarLabel}>{copy.settings.calendarTitle}</Text>
          <Text style={styles.hint}>{copy.settings.calendarHint}</Text>
          <Button size="sm" variant="secondary" onPress={onOpenCalendar}>
            {copy.today.briefing.meetingsOpenSettings}
          </Button>
        </View>
        <View style={styles.hairline} />
        <View style={styles.limitPad}>
          <Field
            label={copy.settings.dailyModelCallLimit}
            value={limitDraft}
            keyboardType="number-pad"
            inputMode="numeric"
            isInvalid={limitError !== ''}
            onChangeText={(value) => {
              setLimitDraft(value);
              if (limitError) setLimitError('');
            }}
            onBlur={() => commitLimit(limitDraft)}
          />
          {limitError ? <Text style={styles.limitError}>{limitError}</Text> : null}
          <Text style={styles.hint}>
            {copy.settings.dailyModelCallLimitHint.replace(
              '{n}',
              String(DEFAULT_DAILY_MODEL_CALL_LIMIT),
            )}
          </Text>
        </View>
      </View>
    </>
  );
}

export function SettingsPrefSheets({
  prefPicker,
  zones,
  timezone,
  weekStartsOn,
  onClose,
  patchPrefs,
}: {
  prefPicker: 'timezone' | 'week' | null;
  zones: string[];
  timezone: string;
  weekStartsOn: 0 | 1;
  onClose: () => void;
  patchPrefs: (input: PrefsPatch) => Promise<void>;
}) {
  return (
    <>
      <PickerSheet visible={prefPicker === 'timezone'} title={copy.settings.timezone} onClose={onClose}>
        {zones.map((zone) => (
          <PickerOption
            key={zone}
            label={zone}
            selected={zone === timezone}
            onPress={() => {
              onClose();
              void patchPrefs({ timezone: zone });
            }}
          />
        ))}
      </PickerSheet>
      <PickerSheet visible={prefPicker === 'week'} title={copy.settings.weekStartsOn} onClose={onClose}>
        <PickerOption
          label={copy.settings.weekSun}
          selected={weekStartsOn === 0}
          onPress={() => {
            onClose();
            void patchPrefs({ weekStartsOn: 0 });
          }}
        />
        <PickerOption
          label={copy.settings.weekMon}
          selected={weekStartsOn === 1}
          onPress={() => {
            onClose();
            void patchPrefs({ weekStartsOn: 1 });
          }}
        />
      </PickerSheet>
    </>
  );
}
