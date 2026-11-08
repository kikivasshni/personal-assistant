import { useEffect, useState } from 'react';
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
import { db, kvGet, kvSet } from '@/lib/db';
import { scheduleAffirmations } from '@/lib/desires';
import { loadCustomThreads } from '@/lib/hobbies';
import { setupNotifications } from '@/lib/nags';
import { sweepMissed } from '@/lib/commitments';
import { startNotionSync } from '@/lib/sync';
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
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    db()
      .then(async () => {
        // Your own study topics and hobbies must be known before any chat opens.
        await loadCustomThreads().catch(() => {});
        setDataReady(true);
        await sweepMissed();
        await seedDefaults();
        scheduleAffirmations().catch(() => {});
        // Keep Notion in step with everything in the app, both ways.
        startNotionSync();
      })
      .catch(() => setDataReady(true));
    setupNotifications().catch(() => {});
    if (Platform.OS !== 'web') registerNotificationTask().catch(() => {});
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handleResponse(r).catch(() => {});
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (lastResponse && loaded && dataReady) handleResponse(lastResponse).catch(() => {});
  }, [lastResponse, loaded, dataReady]);

  useEffect(() => {
    if (loaded && dataReady) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, dataReady]);

  if (!loaded || !dataReady) return null;

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
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen name="space/[id]" options={{ title: '' }} />
        <Stack.Screen name="food" options={{ title: 'Food log' }} />
        <Stack.Screen name="habits" options={{ title: 'Habits' }} />
        <Stack.Screen name="finance/index" options={{ title: 'Spending' }} />
        <Stack.Screen name="finance/statement" options={{ title: 'Statements' }} />
        <Stack.Screen name="notes/index" options={{ title: 'Study notes' }} />
        <Stack.Screen name="notes/[id]" options={{ title: '' }} />
        <Stack.Screen name="songs/index" options={{ title: 'Songs' }} />
        <Stack.Screen name="songs/[id]" options={{ title: '' }} />
        <Stack.Screen name="desires" options={{ title: 'My desires' }} />
        <Stack.Screen name="mood" options={{ title: 'Moods' }} />
        <Stack.Screen name="exam" options={{ title: 'Exam date', presentation: 'modal' }} />
        <Stack.Screen name="memory" options={{ title: 'Shared memory' }} />
      </Stack>
    </>
  );
}

// First-run defaults that come from your profile (cert exams by 1 Dec 2026).
async function seedDefaults() {
  if (await kvGet('seeded_v2')) return;
  for (const id of ['study.aws', 'study.terraform']) if (!(await kvGet(`exam:${id}`))) await kvSet(`exam:${id}`, '2026-12-01');
  await kvSet('seeded_v2', '1');
}
