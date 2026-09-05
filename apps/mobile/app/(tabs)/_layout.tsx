import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RequireAuth } from '../../src/components/RequireAuth';
import { copy } from '../../src/lib/copy';
import { useTheme } from '../../src/theme/use-theme';

function TabGlyph({ glyph, focused }: { glyph: string; focused: boolean }) {
  const t = useTheme();
  return (
    <Text style={{ color: focused ? t.accentPrimary : t.fgMuted, fontSize: t.type.body.fontSize }}>
      {glyph}
    </Text>
  );
}

export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tabPad = Math.max(insets.bottom, t.space[5]);
  return (
    <RequireAuth>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: t.bgSurface,
            borderTopColor: t.borderSubtle,
            paddingTop: t.space[1],
            paddingBottom: tabPad,
            height: t.space[12] + tabPad,
          },
          tabBarActiveTintColor: t.accentPrimary,
          tabBarInactiveTintColor: t.fgMuted,
          tabBarLabelStyle: { fontSize: t.type.caption.fontSize },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: copy.nav.today,
            tabBarIcon: ({ focused }) => <TabGlyph glyph="今" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="inbox"
          options={{
            title: copy.nav.inbox,
            tabBarIcon: ({ focused }) => <TabGlyph glyph="读" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: copy.nav.reports,
            tabBarIcon: ({ focused }) => <TabGlyph glyph="报" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: copy.nav.library,
            tabBarIcon: ({ focused }) => <TabGlyph glyph="我" focused={focused} />,
          }}
        />
      </Tabs>
    </RequireAuth>
  );
}
