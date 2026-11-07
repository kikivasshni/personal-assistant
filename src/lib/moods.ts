import type { Icon3DName } from '@/components/Icon3D';
import { palette } from '@/theme';
import { db, dayKey, Mood, parseDayKey } from './db';

// One mood per day (the latest check-in wins), shown on a monthly calendar.

export const MOODS: { value: number; label: string; icon: Icon3DName; tint: string; deep: string }[] = [
  { value: 1, label: 'Rough', icon: 'mood1', tint: palette.rose, deep: palette.roseDeep },
  { value: 2, label: 'Low', icon: 'mood2', tint: palette.peach, deep: palette.peachDeep },
  { value: 3, label: 'Okay', icon: 'mood3', tint: palette.butter, deep: palette.butterDeep },
  { value: 4, label: 'Good', icon: 'mood4', tint: palette.mint, deep: palette.mintDeep },
  { value: 5, label: 'Great', icon: 'mood5', tint: palette.sky, deep: palette.skyDeep },
];

export const moodOf = (v: number) => MOODS[Math.min(5, Math.max(1, Math.round(v))) - 1];

export async function setMood(value: number, note: string | null = null, day = dayKey()) {
  const d = await db();
  const start = parseDayKey(day).getTime();
  const existing = await d.getFirstAsync<Mood>(
    'SELECT * FROM moods WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 1',
    start,
    start + 86_400_000,
  );
  if (existing) {
    await d.runAsync('UPDATE moods SET mood = ?, note = COALESCE(?, note) WHERE id = ?', value, note, existing.id);
  } else {
    // Past days get a noon timestamp so they sit inside that day.
    const at = day === dayKey() ? Date.now() : start + 12 * 3_600_000;
    await d.runAsync('INSERT INTO moods(mood, note, created_at) VALUES(?, ?, ?)', value, note, at);
  }
}

export async function clearMood(day: string) {
  const start = parseDayKey(day).getTime();
  await (await db()).runAsync('DELETE FROM moods WHERE created_at >= ? AND created_at < ?', start, start + 86_400_000);
}

// Map of "YYYY-MM-DD" → that day's mood, for a month (0-based month).
export async function moodsForMonth(year: number, month: number): Promise<Record<string, Mood>> {
  const from = new Date(year, month, 1).getTime();
  const to = new Date(year, month + 1, 1).getTime();
  const rows = await (await db()).getAllAsync<Mood>(
    'SELECT * FROM moods WHERE created_at >= ? AND created_at < ? ORDER BY created_at',
    from,
    to,
  );
  const out: Record<string, Mood> = {};
  for (const r of rows) out[dayKey(new Date(r.created_at))] = r; // later rows overwrite
  return out;
}

export async function todaysMood(): Promise<Mood | null> {
  const m = await moodsForMonth(new Date().getFullYear(), new Date().getMonth());
  return m[dayKey()] ?? null;
}
