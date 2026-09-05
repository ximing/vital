import type { ExpoConfig } from 'expo/config';

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3010';

const config: ExpoConfig = {
  name: 'Vital',
  slug: 'vital',
  scheme: 'vital',
  version: '0.0.0',
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#F4F7F6',
  },
  ios: { bundleIdentifier: 'plus.aimo.vital', supportsTablet: true },
  android: {
    package: 'plus.aimo.vital',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#F4F7F6',
    },
  },
  plugins: ['expo-router', 'expo-secure-store'],
  experiments: { typedRoutes: false },
  extra: { apiUrl },
};

export default config;
