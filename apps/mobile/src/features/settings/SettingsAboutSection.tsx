import { Text, View } from 'react-native';
import { Banner } from '../../components/Banner';
import { NavRow } from '../../components/NavRow';
import { SectionHead } from '../../components/SectionHead';
import { copy } from '../../lib/copy';
import { formatProgress, progressRatio, type UpdatePhase } from './app-update';
import type { SettingsHomeStyles } from './settings-home-styles';

function versionValue(update: {
  phase: string;
  current: { versionName: string };
  bytesDownloaded: number;
  totalBytes: number;
}): string {
  if (update.phase === 'checking') return copy.settings.update.checking;
  if (update.phase === 'downloading') {
    return (
      formatProgress(update.bytesDownloaded, update.totalBytes) || copy.settings.update.downloading
    );
  }
  if (update.phase === 'ready') return copy.settings.update.readyShort;
  if (update.phase === 'installing') return copy.settings.update.installing;
  if (update.phase === 'failed') return copy.settings.update.failed;
  return update.current.versionName;
}

export function SettingsAboutSection({
  styles,
  updatePhase,
  updateBytes,
  updateTotal,
  updateNotes,
  versionName,
  onPressPrimary,
  onInstall,
}: {
  styles: SettingsHomeStyles;
  updatePhase: UpdatePhase;
  updateBytes: number;
  updateTotal: number;
  updateNotes: string | null | undefined;
  versionName: string;
  onPressPrimary: () => void;
  onInstall: () => void;
}) {
  return (
    <>
      <SectionHead title={copy.settings.tabs.about} />
      <View style={[styles.card, styles.cardFlush]}>
        <NavRow
          label={copy.settings.update.version}
          value={versionValue({
            phase: updatePhase,
            current: { versionName },
            bytesDownloaded: updateBytes,
            totalBytes: updateTotal,
          })}
          onPress={() => void onPressPrimary()}
        />
      </View>
      {updatePhase === 'downloading' ? (
        <View style={styles.progressBlock}>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(progressRatio(updateBytes, updateTotal) * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.hint}>
            {formatProgress(updateBytes, updateTotal) || copy.settings.update.downloading}
          </Text>
        </View>
      ) : null}
      {updatePhase === 'ready' ? (
        <View style={styles.bannerWrap}>
          <Banner
            tone="info"
            action={{
              label: copy.settings.update.install,
              onPress: () => void onInstall(),
            }}
          >
            {copy.settings.update.ready}
          </Banner>
        </View>
      ) : null}
      {updateNotes && updatePhase !== 'idle' ? (
        <Text style={styles.hint}>{updateNotes}</Text>
      ) : null}
    </>
  );
}
