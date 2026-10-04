import type { ExpoConfig } from 'expo/config';
import {
  type ConfigPlugin,
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle,
} from '@expo/config-plugins';
import fs from 'node:fs';
import path from 'node:path';
import { addAgcpClasspath, addHuaweiMaven, applyAgcpPlugin } from './huawei-gradle.cjs';

const version = process.env.APP_VERSION_NAME ?? '0.0.0';
const versionCode = Number(process.env.APP_VERSION_CODE ?? 1);

const SIGNING_BLOCK = `// --- begin vital env signing (injected by withEnvReleaseSigning) ---
android {
    signingConfigs {
        release {
            def storeFilePath = System.getenv("RELEASE_STORE_FILE")
            if (storeFilePath != null) {
                storeFile file(storeFilePath)
                storePassword System.getenv("RELEASE_STORE_STORE_PASSWORD")
                keyAlias System.getenv("RELEASE_KEY_ALIAS")
                keyPassword System.getenv("RELEASE_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
// --- end vital env signing ---`;

const withHuaweiPush: ConfigPlugin = (config) => {
  config = withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') return mod;
    mod.modResults.contents = addAgcpClasspath(addHuaweiMaven(mod.modResults.contents));
    return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') return mod;
    const json = path.join(mod.modRequest.projectRoot, 'agconnect-services.json');
    if (!fs.existsSync(json)) return mod;
    mod.modResults.contents = applyAgcpPlugin(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, 'agconnect-services.json');
      const dest = path.join(cfg.modRequest.platformProjectRoot, 'app', 'agconnect-services.json');
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
      return cfg;
    },
  ]);
};

const withEnvReleaseSigning: ConfigPlugin = (config) => {
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('RELEASE_STORE_FILE')) {
      mod.modResults.contents += `\n${SIGNING_BLOCK}\n`;
    }
    return mod;
  });
};

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3010';

const config: ExpoConfig = {
  name: 'Vital',
  slug: 'vital',
  scheme: 'vital',
  version,
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#F3F5F2',
  },
  ios: { bundleIdentifier: 'plus.aimo.vital', supportsTablet: true },
  android: {
    package: 'plus.aimo.vital',
    versionCode,
    permissions: ['android.permission.REQUEST_INSTALL_PACKAGES'],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FFFFFF',
    },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-image-picker',
      {
        photosPermission: '允许 Vital 选取头像。',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: '允许 Vital 扫描网页登录二维码。',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    withEnvReleaseSigning as unknown as string,
    withHuaweiPush as unknown as string,
  ],
  experiments: { typedRoutes: false },
  extra: { apiUrl },
};

export default config;
