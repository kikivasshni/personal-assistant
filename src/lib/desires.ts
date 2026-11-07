import * as Notifications from 'expo-notifications';
import { addDays, db, dayKey, Desire, kvGet, kvSet } from './db';
import { generateJson } from './gemini';

// Desires you're assuming, and the morning/night affirmations built from them.

export async function listDesires(): Promise<Desire[]> {
  return (await db()).getAllAsync<Desire>(
    "SELECT * FROM desires WHERE status != 'released' ORDER BY status = 'manifested', COALESCE(manifested_at, created_at) DESC",
  );
}

export async function saveDesire(input: {
  id?: number | null;
  title?: string;
  detail?: string | null;
  scene?: string | null;
  status?: Desire['status'];
  story?: string | null;
}): Promise<Desire> {
  const d = await db();
  let id = input.id ?? null;
  if (!id && input.title) {
    const hit = await d.getFirstAsync<{ id: number }>('SELECT id FROM desires WHERE lower(title) = lower(?)', input.title);
    id = hit?.id ?? null;
  }
  if (!id) {
    const r = await d.runAsync(
      'INSERT INTO desires(title, detail, scene, status, created_at) VALUES(?, ?, ?, ?, ?)',
      input.title ?? 'New desire',
      input.detail ?? null,
      input.scene ?? null,
      input.status ?? 'pending',
      Date.now(),
    );
    id = r.lastInsertRowId;
  } else {
    const cur = await d.getFirstAsync<Desire>('SELECT * FROM desires WHERE id = ?', id);
    if (!cur) throw new Error(`No desire #${id}.`);
    const status = input.status ?? cur.status;
    await d.runAsync(
      'UPDATE desires SET title = ?, detail = ?, scene = ?, status = ?, story = ?, manifested_at = ? WHERE id = ?',
      input.title ?? cur.title,
      input.detail !== undefined ? input.detail : cur.detail,
      input.scene !== undefined ? input.scene : cur.scene,
      status,
      input.story !== undefined ? input.story : cur.story,
      status === 'manifested' ? (cur.manifested_at ?? Date.now()) : null,
      id,
    );
  }
  // New wording means new affirmations.
  kvSet('affirmations_until', '0').catch(() => {});
  return (await d.getFirstAsync<Desire>('SELECT * FROM desires WHERE id = ?', id))!;
}

export async function deleteDesire(id: number) {
  await (await db()).runAsync('DELETE FROM desires WHERE id = ?', id);
}

// ---------- affirmations ----------

export type AffirmationTimes = { morning: string; night: string };
export type DayAffirmations = { day: string; morning: string; night: string };

export async function getAffirmationTimes(): Promise<AffirmationTimes> {
  return { morning: (await kvGet('aff_morning')) ?? '07:30', night: (await kvGet('aff_night')) ?? '22:30' };
}

export async function affirmationsPlan(): Promise<DayAffirmations[]> {
  const raw = await kvGet('affirmations_plan');
  return raw ? (JSON.parse(raw) as DayAffirmations[]) : [];
}

export async function todaysAffirmations(): Promise<DayAffirmations | null> {
  const plan = await affirmationsPlan();
  return plan.find((p) => p.day === dayKey()) ?? null;
}

function hm(s: string) {
  const [h, m] = s.split(':').map(Number);
  return { h: Number.isFinite(h) ? h : 7, m: Number.isFinite(m) ? m : 0 };
}

// Writes 7 days of morning and night affirmations for your pending desires and
// schedules them as notifications. Runs again when the plan is nearly used up
// or your desires change.
export async function scheduleAffirmations(force = false, times?: AffirmationTimes): Promise<number> {
  if (times) {
    await kvSet('aff_morning', times.morning);
    await kvSet('aff_night', times.night);
  }
  const until = Number((await kvGet('affirmations_until')) ?? 0);
  if (!force && until - Date.now() > 2 * 86_400_000) return 0;
  const pending = (await listDesires()).filter((d) => d.status === 'pending');
  const old = JSON.parse((await kvGet('affirmation_ids')) ?? '[]') as string[];
  await Promise.all(old.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  if (!pending.length) {
    await kvSet('affirmation_ids', '[]');
    return 0;
  }

  const r = await generateJson<{ days: { morning: string; night: string }[] }>(
    `Write 7 days of affirmations for kirthi in the style of Neville Goddard's Law of Assumption: first person, present tense, feeling of the wish fulfilled, specific and sensory, under 140 characters each. Morning: an energising "I am / I have" statement for the day. Night: a SATS-style line to fall asleep in, as if it's already done (e.g. "Thank you, it's done…").
Rotate through these desires so each gets airtime:
${pending.map((d) => `- ${d.title}${d.detail ? `: ${d.detail}` : ''}`).join('\n')}
Return JSON: {"days": [{"morning": "", "night": ""}]}`,
    { temperature: 0.9 },
  );
  const t = times ?? (await getAffirmationTimes());
  const am = hm(t.morning);
  const pm = hm(t.night);
  const ids: string[] = [];
  const plan: DayAffirmations[] = [];
  for (let i = 0; i < Math.min(7, r.days?.length ?? 0); i++) {
    const day = addDays(new Date(), i);
    const morningAt = new Date(day);
    morningAt.setHours(am.h, am.m, 0, 0);
    const nightAt = new Date(day);
    nightAt.setHours(pm.h, pm.m, 0, 0);
    plan.push({ day: dayKey(day), morning: r.days[i].morning, night: r.days[i].night });
    for (const [at, title, body] of [
      [morningAt, 'Morning assumption', r.days[i].morning],
      [nightAt, 'Before you sleep', r.days[i].night],
    ] as const) {
      if (at.getTime() < Date.now() + 60_000) continue;
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: { title, body, data: { url: '/chat/manifest.desires' } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'daily' },
        }),
      );
    }
  }
  await kvSet('affirmation_ids', JSON.stringify(ids));
  await kvSet('affirmations_plan', JSON.stringify(plan));
  await kvSet('affirmations_until', String(addDays(new Date(), plan.length).getTime()));
  return ids.length;
}
