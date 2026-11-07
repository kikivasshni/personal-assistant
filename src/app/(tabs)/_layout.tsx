import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const icon =
  (name: IconName, active: IconName) =>
  ({ color, focused }: { color: unknown; focused: boolean }) => (
    <Ionicons name={focused ? active : name} size={23} color={typeof color === 'string' ? color : undefined} />
  );

export default function TabsLayout() {
  // Samsung's 3-button navigation bar sits on top of edge-to-edge apps, so
  // the tab bar has to grow by the bottom inset instead of using a fixed height.
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: '#FFFFFFF2',
          borderTopWidth: 0,
          height: 62 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom + 8,
          elevation: 12,
          shadowColor: '#6B5BD6',
          shadowOpacity: 0.08,
          shadowRadius: 20,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('sunny-outline', 'sunny') }} />
      <Tabs.Screen name="life" options={{ title: 'Life', tabBarIcon: icon('grid-outline', 'grid') }} />
      <Tabs.Screen name="feed" options={{ title: 'Feed', tabBarIcon: icon('play-circle-outline', 'play-circle') }} />
      <Tabs.Screen name="settings" options={{ title: 'You', tabBarIcon: icon('person-circle-outline', 'person-circle') }} />
    </Tabs>
  );
}
