import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { setCommitmentStatus, snoozeCommitment } from './commitments';

// Handles the Done / Snooze buttons on nag notifications.
//
// On Android, buttons that don't open the app are delivered to a background
// task, not to the in-app listener, so the task is defined at startup (from
// index.js) and registered with expo-notifications. The in-app listener uses
// the same handler for taps while the app is open.

export const NOTIFICATION_TASK = 'kairos-notification-actions';

const handled = new Set<string>();

export async function handleNotificationResponse(r: Notifications.NotificationResponse): Promise<string | null> {
  const req = r.notification.request;
  const key = `${req.identifier}:${r.actionIdentifier}`;
  if (handled.has(key)) return null;
  handled.add(key);

  const data = (req.content.data ?? {}) as { commitmentId?: number | string; url?: string };
  const id = data.commitmentId != null ? Number(data.commitmentId) : null;

  if (id && r.actionIdentifier === 'done') {
    await setCommitmentStatus(id, 'done');
    await Notifications.dismissNotificationAsync(req.identifier).catch(() => {});
    return null;
  }
  if (id && r.actionIdentifier === 'snooze') {
    await snoozeCommitment(id, 30);
    await Notifications.dismissNotificationAsync(req.identifier).catch(() => {});
    return null;
  }
  if (r.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) return data.url ?? null;
  return null;
}

if (!TaskManager.isTaskDefined(NOTIFICATION_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(NOTIFICATION_TASK, async ({ data, error }) => {
    if (error || !data || !('actionIdentifier' in data)) return;
    try {
      await handleNotificationResponse(data as Notifications.NotificationResponse);
    } catch {
      // nothing useful to do from the background
    }
  });
}

export async function registerNotificationTask() {
  await Notifications.registerTaskAsync(NOTIFICATION_TASK);
}
