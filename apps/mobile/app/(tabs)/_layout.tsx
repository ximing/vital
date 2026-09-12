import { BookOpen, Calendar, CheckSquare, Sun, User } from 'lucide-react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RequireAuth } from '../../src/components/RequireAuth';
import { copy } from '../../src/lib/copy';
import { useTheme } from '../../src/theme/use-theme';
import { Icon } from '../../src/ui/icon';

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
            tabBarIcon: ({ focused, color }) => (
              <Icon icon={Sun} color={focused ? t.accentPrimary : color} size={22} />
            ),
          }}
        />
        <Tabs.Screen
          name="todos"
          options={{
            title: copy.nav.todos,
            tabBarIcon: ({ focused, color }) => (
              <Icon icon={CheckSquare} color={focused ? t.accentPrimary : color} size={22} />
            ),
          }}
        />
        <Tabs.Screen
          name="inbox"
          options={{
            title: copy.nav.inbox,
            tabBarIcon: ({ focused, color }) => (
              <Icon icon={BookOpen} color={focused ? t.accentPrimary : color} size={22} />
            ),
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: copy.nav.reports,
            tabBarIcon: ({ focused, color }) => (
              <Icon icon={Calendar} color={focused ? t.accentPrimary : color} size={22} />
            ),
          }}
        />
        <Tabs.Screen
          name="me"
          options={{
            title: copy.nav.me,
            tabBarIcon: ({ focused, color }) => (
              <Icon icon={User} color={focused ? t.accentPrimary : color} size={22} />
            ),
          }}
        />
      </Tabs>
    </RequireAuth>
  );
}
