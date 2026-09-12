import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RSRoot } from '@rabjs/react';
import { setupRNDebug } from '@rabjs/rn-debug';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastHost } from '../src/components/ToastHost';
import { TaskSheetHost } from '../src/components/TaskSheetHost';
import { copy } from '../src/lib/copy';
import { authService } from '../src/services/auth.service';
import { registerMobileServices } from '../src/services/register';
import { themeService } from '../src/services/theme.service';
import { hydrateThemeChoice } from '../src/theme/preference';
import { useTheme } from '../src/theme/use-theme';

registerMobileServices();
void hydrateThemeChoice();

if (__DEV__) {
  try {
    setupRNDebug({ host: '127.0.0.1', port: 9229, appName: 'Vital' });
  } catch {
    // Debug daemon is optional during local UI work.
  }
}

export default function RootLayout() {
  const t = useTheme();

  useEffect(() => {
    themeService().start();
    authService().start();
  }, []);

  return (
    <RSRoot>
      <SafeAreaProvider>
        <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
        <View style={{ flex: 1, backgroundColor: t.bgCanvas }}>
          <TaskSheetHost>
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
          </TaskSheetHost>
          <ToastHost />
        </View>
      </SafeAreaProvider>
    </RSRoot>
  );
}
