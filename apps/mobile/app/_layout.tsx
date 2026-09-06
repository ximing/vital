import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth/AuthProvider';
import { ToastHost } from '../src/components/ToastHost';
import { copy } from '../src/lib/copy';
import { hydrateThemeChoice } from '../src/theme/preference';
import { useTheme } from '../src/theme/use-theme';

void hydrateThemeChoice();

export default function RootLayout() {
  const t = useTheme();

  return (
    <AuthProvider>
      <SafeAreaProvider>
        <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
        <View style={{ flex: 1, backgroundColor: t.bgCanvas }}>
          <Stack
            screenOptions={{
              headerBackTitle: copy.back,
              headerStyle: { backgroundColor: t.bgCanvas },
              headerTintColor: t.fgPrimary,
              headerShadowVisible: false,
              headerTitleStyle: { color: t.fgPrimary, fontWeight: '600' },
              contentStyle: { backgroundColor: t.bgCanvas },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ title: copy.auth.login }} />
            <Stack.Screen name="register" options={{ title: copy.auth.register }} />
            <Stack.Screen name="onboarding" options={{ title: copy.nav.onboarding }} />
            <Stack.Screen name="search" options={{ title: copy.nav.search }} />
          </Stack>
          <ToastHost />
        </View>
      </SafeAreaProvider>
    </AuthProvider>
  );
}
