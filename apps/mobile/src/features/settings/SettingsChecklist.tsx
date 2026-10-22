import { Pressable, Text, View } from 'react-native';
import type { OnboardingChecklistKey } from '@vital/dto';
import { Button } from '../../components/Button';
import { SectionHead } from '../../components/SectionHead';
import { copy } from '../../lib/copy';
import type { SettingsHomeStyles } from './settings-home-styles';

export function SettingsChecklist({
  styles,
  rows,
  onOpen,
  onDismiss,
}: {
  styles: SettingsHomeStyles;
  rows: { key: OnboardingChecklistKey; done: boolean; label: string }[];
  onOpen: (key: OnboardingChecklistKey) => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <SectionHead title={copy.checklist.title} first />
      <View style={[styles.card, styles.cardFlush]}>
        {rows.map((row, index) => (
          <View key={row.key}>
            {index > 0 ? <View style={styles.hairline} /> : null}
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.checkRow, pressed && styles.rowPressed]}
              onPress={() => onOpen(row.key)}
            >
              <Text style={[styles.checkMark, row.done && styles.checkMarkDone]}>
                {row.done ? '✓' : '○'}
              </Text>
              <Text style={[styles.checkTitle, row.done && styles.done]}>{row.label}</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <Button variant="quiet" size="sm" onPress={onDismiss}>
        {copy.checklist.dismiss}
      </Button>
    </>
  );
}
