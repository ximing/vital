import { useEffect, useMemo, useRef } from 'react';
import { Linking, Modal, StyleSheet, Text, View } from 'react-native';
import { observer, useService } from '@rabjs/react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { lightColors, type Theme } from '@vital/tokens';
import { X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { IconButton } from '../../components/IconButton';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { QrLoginScanService } from './qr-login.service';

const frame = lightColors.fgOnAccent;
const ink = lightColors.fgPrimary;

export const QrLoginScanner = observer(function QrLoginScanner() {
  const scan = useService(QrLoginScanService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [permission, requestPermission] = useCameraPermissions();
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current || !permission || permission.granted || !permission.canAskAgain) return;
    asked.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  const showCamera = scan.phase === 'scan' && permission?.granted === true;
  const scanning = showCamera && !scan.busy;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => void scan.dismiss()}
    >
      <View style={styles.root}>
        {showCamera ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanning ? (result) => void scan.onCode(result.data) : undefined}
          />
        ) : (
          <View style={styles.fill} />
        )}
        <SafeAreaView style={styles.chrome} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <IconButton
              icon={X}
              label={copy.me.scanClose}
              color={frame}
              onPress={() => void scan.dismiss()}
            />
          </View>
          {scan.phase === 'confirm' ? (
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>{copy.me.scanConfirmTitle}</Text>
              <Text style={styles.confirmBody}>{copy.me.scanConfirmBody}</Text>
              <ErrorText message={scan.error} />
              <Button
                fullWidth
                loading={scan.busy}
                onPress={() => void scan.confirm()}
              >
                {copy.me.scanConfirm}
              </Button>
              <Button variant="quiet" fullWidth onPress={() => void scan.dismiss()}>
                {copy.me.scanCancel}
              </Button>
            </View>
          ) : (
            <View style={styles.scanBody}>
              <View style={styles.finder} />
              <Text style={styles.hint}>{copy.me.scanHint}</Text>
              <ErrorText message={scan.error} />
              {permission && !permission.granted ? (
                <View style={styles.permission}>
                  <Text style={styles.hint}>{copy.me.scanDenied}</Text>
                  {permission.canAskAgain ? (
                    <Button onPress={() => void requestPermission()}>{copy.me.scanAllow}</Button>
                  ) : (
                    <Button onPress={() => void Linking.openSettings()}>
                      {copy.me.scanOpenSettings}
                    </Button>
                  )}
                </View>
              ) : null}
            </View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: ink },
    fill: { ...StyleSheet.absoluteFillObject, backgroundColor: ink },
    chrome: { flex: 1, justifyContent: 'space-between' },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: t.space[2],
    },
    scanBody: {
      alignItems: 'center',
      paddingHorizontal: t.space[6],
      paddingBottom: t.space[8],
      gap: t.space[3],
    },
    finder: {
      width: 240,
      height: 240,
      borderWidth: 2,
      borderColor: frame,
      borderRadius: t.radius.lg,
    },
    hint: {
      color: frame,
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      textAlign: 'center',
    },
    permission: { alignItems: 'center', gap: t.space[3] },
    confirmCard: {
      marginHorizontal: t.space[4],
      marginBottom: t.space[6],
      padding: t.space[4],
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
      gap: t.space[3],
    },
    confirmTitle: {
      color: t.fgPrimary,
      fontSize: t.type.title.fontSize,
      lineHeight: t.type.title.lineHeight,
      fontWeight: '700',
    },
    confirmBody: {
      color: t.fgMuted,
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
    },
  });
