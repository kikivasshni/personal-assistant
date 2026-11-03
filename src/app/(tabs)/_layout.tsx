import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const icon =
  (name: IconName, active: IconName) =>
  ({ color, focused }: { color: unknown; focused: boolean }) => (
    <Ionicons name={focused ? active : name} size={23} color={typeof color === 'string' ? color : undefined} />
  );

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: '#FFFFFFF2',
          borderTopWidth: 0,
          height: 68,
          paddingTop: 8,
          paddingBottom: 10,
          elevation: 12,
          shadowColor: '#6B5BD6',
          shadowOpacity: 0.08,
          shadowRadius: 20,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('sunny-outline', 'sunny') }} />
      <Tabs.Screen name="coaches" options={{ title: 'Coaches', tabBarIcon: icon('chatbubbles-outline', 'chatbubbles') }} />
      <Tabs.Screen name="feed" options={{ title: 'Feed', tabBarIcon: icon('play-circle-outline', 'play-circle') }} />
      <Tabs.Screen name="studio" options={{ title: 'Studio', tabBarIcon: icon('sparkles-outline', 'sparkles') }} />
      <Tabs.Screen name="settings" options={{ title: 'You', tabBarIcon: icon('person-circle-outline', 'person-circle') }} />
    </Tabs>
  );
}
