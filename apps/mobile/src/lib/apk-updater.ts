import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';

export type NativeDownloadState = {
  status: 'idle' | 'downloading' | 'ready' | 'failed';
  versionCode: number | null;
  bytesDownloaded: number;
  totalBytes: number;
  path: string | null;
  message: string | null;
};

type NativeApkUpdater = {
  getState(): NativeDownloadState;
  canInstall(): boolean;
  startDownload(
    url: string,
    versionCode: number,
    sha256: string | null,
  ): Promise<NativeDownloadState>;
  cancelDownload(): Promise<void>;
  openInstallPermissionSettings(): Promise<void>;
  install(versionCode: number): Promise<void>;
};

const native: NativeApkUpdater | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeApkUpdater>('ApkUpdater') : null;

export function isApkUpdaterAvailable(): boolean {
  return native !== null;
}

export function readCurrentVersion(): { versionName: string; versionCode: number } {
  const versionName = Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '0.0.0';
  const raw =
    Platform.OS === 'android'
      ? (Constants.nativeBuildVersion ?? String(Constants.expoConfig?.android?.versionCode ?? 1))
      : (Constants.nativeBuildVersion ?? '1');
  const parsed = Number.parseInt(String(raw), 10);
  return {
    versionName,
    versionCode: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
  };
}

export function getNativeState(): NativeDownloadState | null {
  if (!native) return null;
  try {
    return native.getState();
  } catch {
    return null;
  }
}

export function canInstallPackages(): boolean {
  if (!native) return false;
  try {
    return native.canInstall();
  } catch {
    return false;
  }
}

export async function startApkDownload(input: {
  url: string;
  versionCode: number;
  sha256?: string;
}): Promise<NativeDownloadState | null> {
  if (!native) return null;
  return native.startDownload(input.url, input.versionCode, input.sha256 ?? null);
}

export async function openInstallPermissionSettings(): Promise<void> {
  await native?.openInstallPermissionSettings();
}

export async function installApk(versionCode: number): Promise<void> {
  if (!native) throw new Error('UNSUPPORTED');
  await native.install(versionCode);
}
