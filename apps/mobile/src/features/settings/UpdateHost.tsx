import { useMemo } from 'react';
import { Linking, Modal, StyleSheet, Text, View } from 'react-native';
import { observer, useService } from '@rabjs/react';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { copy } from '../../lib/copy';
import { AppUpdateService } from '../../services/app-update.service';
import { useTheme } from '../../theme/use-theme';
import { formatProgress, progressRatio } from './app-update';

export const UpdateHost = observer(function UpdateHost() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(AppUpdateService);
  if (!s.forced || !s.remote) return null;
  const remote = s.remote;
  const ratio = progressRatio(s.bytesDownloaded, s.totalBytes);
  const pct = formatProgress(s.bytesDownloaded, s.totalBytes);
  const canInstall = s.phase === 'ready';
  const downloading = s.phase === 'downloading' || s.phase === 'checking';

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen">
      <View style={styles.screen}>
        <Text style={styles.title}>{copy.settings.update.forceTitle}</Text>
        <Text style={styles.body}>
          {copy.settings.update.forceBody.replace('{v}', remote.versionName)}
        </Text>
        {remote.releaseNotes ? (
          <Text style={styles.notes}>{remote.releaseNotes}</Text>
        ) : null}
        {downloading ? (
          <View style={styles.progressBlock}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
            </View>
            <Text style={styles.meta}>{pct || copy.settings.update.downloading}</Text>
          </View>
        ) : null}
        {s.phase === 'failed' ? <Text style={styles.error}>{copy.settings.update.failed}</Text> : null}
        {s.pendingPermission ? <Text style={styles.meta}>{copy.settings.update.permission}</Text> : null}
        <View style={styles.actions}>
          {s.supported ? (
            <Button
              size="lg"
              loading={s.phase === 'installing'}
              disabled={!canInstall && s.phase !== 'failed' && !s.pendingPermission}
              onPress={() => void (s.phase === 'failed' ? s.check({ user: true }) : s.install())}
            >
              {s.phase === 'failed'
                ? copy.settings.update.retry
                : s.pendingPermission
                  ? copy.settings.update.grant
                  : copy.settings.update.install}
            </Button>
          ) : (
            <Button size="lg" onPress={() => void Linking.openURL(remote.apkUrl)}>
              {copy.settings.update.install}
            </Button>
          )}
        </View>
      </View>
    </Modal>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.bgCanvas,
      paddingHorizontal: t.space[6],
      paddingVertical: t.space[8],
      justifyContent: 'center',
      gap: t.space[4],
    },
    title: { fontSize: 22, lineHeight: 30, fontWeight: '700', color: t.fgPrimary },
    body: { fontSize: 16, lineHeight: 24, color: t.fgMuted },
    notes: { fontSize: t.type.meta.fontSize, lineHeight: 20, color: t.fgPrimary },
    progressBlock: { gap: t.space[2] },
    track: {
      height: 8,
      borderRadius: 4,
      backgroundColor: t.bgSurfaceMuted,
      overflow: 'hidden',
    },
    fill: { height: 8, borderRadius: 4, backgroundColor: t.accentPrimary },
    meta: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    error: { fontSize: t.type.meta.fontSize, color: t.danger },
    actions: { marginTop: t.space[2] },
  });
