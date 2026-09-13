import { AppState, type NativeEventSubscription, Platform } from 'react-native';
import { resolve, Service } from '@rabjs/react';
import type { AndroidRelease } from '@vital/dto';
import { toast } from '../components/toast';
import {
  isForcedUpdate,
  isNewerRelease,
  type UpdatePhase,
} from '../features/settings/app-update';
import { client } from '../lib/api';
import {
  canInstallPackages,
  getNativeState,
  installApk,
  isApkUpdaterAvailable,
  openInstallPermissionSettings,
  readCurrentVersion,
  startApkDownload,
  type NativeDownloadState,
} from '../lib/apk-updater';
import { copy } from '../lib/copy';
import { humanError } from '../lib/errors';

const POLL_MS = 1_000;

export class AppUpdateService extends Service {
  supported = false;
  phase: UpdatePhase = 'idle';
  current = { versionName: '0.0.0', versionCode: 1 };
  remote: AndroidRelease | null = null;
  bytesDownloaded = 0;
  totalBytes = 0;
  error: string | null = null;
  pendingPermission = false;
  private started = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private appSub: NativeEventSubscription | null = null;
  private toastedCode: number | null = null;
  private checkInFlight: Promise<void> | null = null;

  get forced(): boolean {
    if (!this.supported) return false;
    return isForcedUpdate(this.current.versionCode, this.remote?.minVersionCode);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.supported = Platform.OS === 'android' && isApkUpdaterAvailable();
    this.current = readCurrentVersion();
    this.appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void this.onForeground();
    });
    void this.check();
  }

  stop(): void {
    this.started = false;
    this.stopPolling();
    this.appSub?.remove();
    this.appSub = null;
  }

  async pressPrimary(): Promise<void> {
    if (this.phase === 'ready') {
      await this.install();
      return;
    }
    if (this.phase === 'failed') {
      await this.check({ user: true });
      return;
    }
    if (this.phase === 'downloading' || this.phase === 'installing' || this.phase === 'checking') {
      return;
    }
    await this.check({ user: true });
  }

  async check(opts: { user?: boolean } = {}): Promise<void> {
    if (this.checkInFlight) return this.checkInFlight;
    this.checkInFlight = this.runCheck(opts).finally(() => {
      this.checkInFlight = null;
    });
    return this.checkInFlight;
  }

  async install(): Promise<void> {
    const remote = this.remote;
    if (!remote || !this.supported) return;
    try {
      if (!canInstallPackages()) {
        this.pendingPermission = true;
        await openInstallPermissionSettings();
        return;
      }
      this.phase = 'installing';
      this.error = null;
      await installApk(remote.versionCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('INSTALL_PERMISSION')) {
        this.pendingPermission = true;
        this.phase = 'ready';
        await openInstallPermissionSettings();
        return;
      }
      this.phase = 'failed';
      this.error = copy.settings.update.failed;
      toast(humanError(err));
    }
  }

  private async onForeground(): Promise<void> {
    if (this.pendingPermission && this.supported && canInstallPackages()) {
      this.pendingPermission = false;
      await this.install();
      return;
    }
    await this.check();
  }

  private async runCheck(opts: { user?: boolean }): Promise<void> {
    const user = opts.user === true;
    this.error = null;
    if (user && this.phase === 'idle') this.phase = 'checking';
    try {
      const res = await client.getAndroidRelease();
      this.remote = res.android;
    } catch (err) {
      if (user) toast(humanError(err));
      if (this.phase === 'checking') this.phase = 'idle';
      return;
    }
    const remote = this.remote;
    if (!remote || !isNewerRelease(this.current.versionCode, remote.versionCode)) {
      this.stopPolling();
      this.phase = 'idle';
      if (user) toast(copy.settings.update.upToDate);
      return;
    }
    if (!this.supported) {
      this.phase = 'idle';
      if (user) toast(copy.settings.update.available.replace('{v}', remote.versionName));
      return;
    }
    await this.syncNative(remote, user);
  }

  private async syncNative(remote: AndroidRelease, user: boolean): Promise<void> {
    const native = getNativeState();
    if (native && native.versionCode === remote.versionCode) {
      this.applyNative(native, remote);
      if (this.phase === 'downloading') this.startPolling();
      return;
    }
    try {
      const started = await startApkDownload({
        url: remote.apkUrl,
        versionCode: remote.versionCode,
        sha256: remote.sha256,
      });
      if (started) this.applyNative(started, remote);
      else this.phase = 'downloading';
      this.startPolling();
    } catch (err) {
      this.phase = 'failed';
      this.error = copy.settings.update.failed;
      if (user) toast(humanError(err));
    }
  }

  private applyNative(state: NativeDownloadState, remote: AndroidRelease): void {
    this.bytesDownloaded = state.bytesDownloaded;
    this.totalBytes = state.totalBytes;
    if (state.status === 'ready' && state.versionCode === remote.versionCode) {
      this.phase = 'ready';
      this.stopPolling();
      this.notifyReady(remote);
      return;
    }
    if (state.status === 'failed') {
      this.phase = 'failed';
      this.error = copy.settings.update.failed;
      this.stopPolling();
      return;
    }
    this.phase = 'downloading';
  }

  private notifyReady(remote: AndroidRelease): void {
    if (this.toastedCode === remote.versionCode) return;
    this.toastedCode = remote.versionCode;
    toast({
      message: copy.settings.update.toastReady.replace('{v}', remote.versionName),
      action: { label: copy.settings.update.install, onPress: () => void this.install() },
      durationMs: 8_000,
    });
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      const remote = this.remote;
      if (!remote) return;
      const native = getNativeState();
      if (native) this.applyNative(native, remote);
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}

export function appUpdateService(): AppUpdateService {
  return resolve(AppUpdateService);
}
