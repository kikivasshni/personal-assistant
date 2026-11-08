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

// Accepts "7:30", "07.30", "730", "7:30 pm", "22:30". Returns null if unreadable.
export function parseTime(s: string): { h: number; m: number } | null {
  const t = s.trim().toLowerCase();
  const match = t.match(/^(\d{1,2})(?:[:.\s]?(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2] ?? 0);
  if (match[3] === 'pm' && h < 12) h += 12;
  if (match[3] === 'am' && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return { h, m };
}

// Gemini doesn't always use the exact shape asked for; accept the common ones.
function readDays(r: unknown): { morning: string; night: string }[] {
  const arr = Array.isArray(r)
    ? r
    : r && typeof r === 'object'
      ? (Object.values(r as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined)
      : undefined;
  return (arr ?? [])
    .map((d) => d as { morning?: unknown; night?: unknown })
    .filter((d) => typeof d?.morning === 'string' && typeof d?.night === 'string')
    .map((d) => ({ morning: String(d.morning), night: String(d.night) }));
}

// Writes 7 days of morning and night affirmations for your pending desires and
// schedules them as notifications. Runs again when the plan is nearly used up
// or your desires change.
export async function scheduleAffirmations(force = false, times?: AffirmationTimes): Promise<number> {
  if (times) {
    if (!parseTime(times.morning)) throw new Error(`"${times.morning}" isn't a time. Use something like 07:30.`);
    if (!parseTime(times.night)) throw new Error(`"${times.night}" isn't a time. Use something like 22:30.`);
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

  const raw = await generateJson<unknown>(
    `Write 7 days of affirmations for kirthi in the style of Neville Goddard's Law of Assumption: first person, present tense, feeling of the wish fulfilled, specific and sensory, under 140 characters each. Morning: an energising "I am / I have" statement for the day. Night: a SATS-style line to fall asleep in, as if it's already done (e.g. "Thank you, it's done…").
Rotate through these desires so each gets airtime:
${pending.map((d) => `- ${d.title}${d.detail ? `: ${d.detail}` : ''}`).join('\n')}
Return JSON: {"days": [{"morning": "", "night": ""}]}`,
    { temperature: 0.9 },
  );
  const days = readDays(raw);
  if (!days.length) throw new Error("Gemini didn't return any affirmations. Try again.");
  const t = times ?? (await getAffirmationTimes());
  const am = parseTime(t.morning) ?? { h: 7, m: 30 };
  const pm = parseTime(t.night) ?? { h: 22, m: 30 };
  const ids: string[] = [];
  const plan: DayAffirmations[] = [];
  for (let i = 0; i < Math.min(7, days.length); i++) {
    const day = addDays(new Date(), i);
    const morningAt = new Date(day);
    morningAt.setHours(am.h, am.m, 0, 0);
    const nightAt = new Date(day);
    nightAt.setHours(pm.h, pm.m, 0, 0);
    plan.push({ day: dayKey(day), morning: days[i].morning, night: days[i].night });
    for (const [at, title, body] of [
      [morningAt, 'Morning assumption', days[i].morning],
      [nightAt, 'Before you sleep', days[i].night],
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
