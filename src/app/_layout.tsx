import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import {
  useFonts,
  Fraunces_400Regular_Italic,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import { Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { colors, fonts } from '@/theme';
import { db } from '@/lib/db';
import { setupNotifications } from '@/lib/nags';
import { sweepMissed } from '@/lib/commitments';
import { handleNotificationResponse, registerNotificationTask } from '@/lib/notificationActions';

SplashScreen.preventAutoHideAsync().catch(() => {});

async function handleResponse(r: Notifications.NotificationResponse) {
  const url = await handleNotificationResponse(r);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (url) router.push(url as any);
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Fraunces_400Regular_Italic,
    Fraunces_600SemiBold,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });
  // Platform never changes at runtime, so this conditional hook call is stable.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const lastResponse = Platform.OS === 'web' ? null : Notifications.useLastNotificationResponse();

  useEffect(() => {
    db()
      .then(() => sweepMissed())
      .catch(() => {});
    setupNotifications().catch(() => {});
    if (Platform.OS !== 'web') registerNotificationTask().catch(() => {});
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handleResponse(r).catch(() => {});
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (lastResponse && loaded) handleResponse(lastResponse).catch(() => {});
  }, [lastResponse, loaded]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  if (!loaded) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.display, fontSize: 20 },
          contentStyle: { backgroundColor: colors.bg },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[coach]" options={{ title: '' }} />
        <Stack.Screen name="studio/food" options={{ title: 'Food log' }} />
        <Stack.Screen name="studio/money" options={{ title: 'Money' }} />
        <Stack.Screen name="studio/notes" options={{ title: 'Study notes' }} />
        <Stack.Screen name="notes/[id]" options={{ title: '' }} />
        <Stack.Screen name="memory" options={{ title: 'Shared memory' }} />
      </Stack>
    </>
  );
}
