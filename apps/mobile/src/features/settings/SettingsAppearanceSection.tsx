import { Text, View } from 'react-native';
import { SectionHead } from '../../components/SectionHead';
import { ThemeToggle } from '../../components/ThemeToggle';
import { copy } from '../../lib/copy';
import type { SettingsHomeStyles } from './settings-home-styles';

export function SettingsAppearanceSection({ styles }: { styles: SettingsHomeStyles }) {
  return (
    <>
      <SectionHead title={copy.settings.tabs.appearance} />
      <View style={styles.card}>
        <Text style={styles.hint}>{copy.theme.hint}</Text>
        <ThemeToggle />
      </View>
    </>
  );
}
