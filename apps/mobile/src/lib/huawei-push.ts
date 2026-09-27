import { PermissionsAndroid, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { client } from './api';
import { createHuaweiRegistrar } from './huawei-push-sync';

type NativeHuaweiPush = {
  getToken(): Promise<string>;
};

const native: NativeHuaweiPush | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeHuaweiPush>('HuaweiPush') : null;

const registrar = native
  ? createHuaweiRegistrar({
      getToken: () => native.getToken(),
      register: (token) => client.registerPushDevice({ provider: 'huawei', token }).then(() => undefined),
    })
  : null;

let permissionAsked = false;

async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const version = typeof Platform.Version === 'number' ? Platform.Version : Number.parseInt(String(Platform.Version), 10);
  if (!Number.isFinite(version) || version < 33) return;
  const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(perm)) return;
  if (permissionAsked) return;
  permissionAsked = true;
  await PermissionsAndroid.request(perm);
}

/** Ask for notification permission, then register the Huawei token when one exists. */
export function syncHuaweiPush(): Promise<void> {
  if (!registrar) return Promise.resolve();
  return ensureNotificationPermission()
    .catch(() => undefined)
    .then(() => registrar.sync());
}
