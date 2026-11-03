import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { kvGet, kvSet } from './db';

// Nags work without any server: when you commit to something, the whole
// escalation chain is scheduled as local alarms at once. Checking in cancels
// whatever hasn't fired yet.

export const NAG_CATEGORY = 'commitment';
export const ESCALATION_MINUTES = [0, 30, 75];

let ready = false;

export async function setupNotifications() {
  if (ready) return;
  ready = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('nags', {
      name: 'Nags and check-ins',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#7C6CF2',
    });
    await Notifications.setNotificationChannelAsync('daily', {
      name: 'Morning briefing and evening audit',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.setNotificationCategoryAsync(NAG_CATEGORY, [
    { identifier: 'done', buttonTitle: 'Done ✓', options: { opensAppToForeground: false } },
    { identifier: 'snooze', buttonTitle: 'Snooze 30 min', options: { opensAppToForeground: false } },
  ]);
}

export async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export type NagLines = [string, string, string];

export async function scheduleChain(
  commitmentId: number,
  title: string,
  dueAt: number,
  lines: NagLines,
  coachName: string,
): Promise<string[]> {
  const ids: string[] = [];
  const headers = [coachName, `${coachName} · still waiting`, 'Drive · no more excuses'];
  for (let i = 0; i < ESCALATION_MINUTES.length; i++) {
    const at = dueAt + ESCALATION_MINUTES[i] * 60_000;
    if (at <= Date.now() + 5_000) continue;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: headers[i],
        body: lines[i] || title,
        categoryIdentifier: NAG_CATEGORY,
        data: { commitmentId, level: i + 1, url: '/' },
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'nags' },
    });
    ids.push(id);
  }
  return ids;
}

export async function cancelIds(ids: string[]) {
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

export type DailyTimes = { briefing: string; audit: string }; // "08:00", "21:00"

export async function getDailyTimes(): Promise<DailyTimes> {
  return {
    briefing: (await kvGet('briefing_time')) ?? '08:00',
    audit: (await kvGet('audit_time')) ?? '21:00',
  };
}

function hm(s: string): { hour: number; minute: number } {
  const [h, m] = s.split(':').map((n) => parseInt(n, 10));
  return { hour: Number.isFinite(h) ? h : 8, minute: Number.isFinite(m) ? m : 0 };
}

export async function scheduleDaily(times?: DailyTimes) {
  const t = times ?? (await getDailyTimes());
  await kvSet('briefing_time', t.briefing);
  await kvSet('audit_time', t.audit);
  await Notifications.cancelScheduledNotificationAsync('daily-briefing').catch(() => {});
  await Notifications.cancelScheduledNotificationAsync('daily-audit').catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: 'daily-briefing',
    content: {
      title: 'Good morning ☀️',
      body: 'Your briefing is ready. Tap to see the day.',
      data: { url: '/?briefing=1' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, channelId: 'daily', ...hm(t.briefing) },
  });
  await Notifications.scheduleNotificationAsync({
    identifier: 'daily-audit',
    content: {
      title: 'Evening audit 🌙',
      body: 'Two minutes: what got done, what slipped, what moves to tomorrow?',
      data: { url: '/chat/hq?audit=1' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, channelId: 'daily', ...hm(t.audit) },
  });
}

export async function testNotification() {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'The Oracle', body: 'Notifications are working 🔮', categoryIdentifier: NAG_CATEGORY },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: 'nags' },
  });
}

// Android 12+: exact alarms need "Alarms & reminders" allowed for the app.
export function openAlarmSettings() {
  if (Platform.OS === 'android') {
    Linking.sendIntent('android.settings.REQUEST_SCHEDULE_EXACT_ALARM').catch(() => Linking.openSettings());
  } else {
    Linking.openSettings();
  }
}
