import type { ExpoConfig } from 'expo/config';
import { type ConfigPlugin, withAppBuildGradle } from '@expo/config-plugins';

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
    backgroundColor: '#FFFBF5',
  },
  ios: { bundleIdentifier: 'plus.aimo.vital', supportsTablet: true },
  android: {
    package: 'plus.aimo.vital',
    versionCode,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FFFBF5',
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
    withEnvReleaseSigning as unknown as string,
  ],
  experiments: { typedRoutes: false },
  extra: { apiUrl },
};

export default config;
