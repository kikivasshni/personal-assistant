import type { Thread } from '@/data/spaces';
import { setCustomThreads, SpaceId } from '@/data/spaces';
import { db, Song } from './db';

// Songs (guitar), practice logs (any hobby or study topic) and your own cards.

export async function listSongs(): Promise<Song[]> {
  return (await db()).getAllAsync<Song>(
    "SELECT * FROM songs ORDER BY CASE status WHEN 'learning' THEN 0 WHEN 'wishlist' THEN 1 ELSE 2 END, updated_at DESC",
  );
}

export async function getSong(id: number): Promise<Song | null> {
  return (await db()).getFirstAsync<Song>('SELECT * FROM songs WHERE id = ?', id);
}

export async function saveSong(input: {
  title: string;
  artist?: string | null;
  status?: Song['status'];
  notes?: string | null;
  tabs?: string | null;
}): Promise<Song> {
  const d = await db();
  const cur = await d.getFirstAsync<Song>('SELECT * FROM songs WHERE lower(title) = lower(?)', input.title);
  const now = Date.now();
  if (cur) {
    await d.runAsync(
      'UPDATE songs SET artist = ?, status = ?, notes = ?, tabs = ?, updated_at = ? WHERE id = ?',
      input.artist ?? cur.artist,
      input.status ?? cur.status,
      input.notes ?? cur.notes,
      input.tabs ?? cur.tabs,
      now,
      cur.id,
    );
    return (await getSong(cur.id))!;
  }
  const r = await d.runAsync(
    'INSERT INTO songs(title, artist, status, notes, tabs, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)',
    input.title,
    input.artist ?? null,
    input.status ?? 'learning',
    input.notes ?? null,
    input.tabs ?? null,
    now,
    now,
  );
  return (await getSong(r.lastInsertRowId))!;
}

export async function setSongStatus(id: number, status: Song['status']) {
  await (await db()).runAsync('UPDATE songs SET status = ?, updated_at = ? WHERE id = ?', status, Date.now(), id);
}

export async function deleteSong(id: number) {
  await (await db()).runAsync('DELETE FROM songs WHERE id = ?', id);
}

// ---------- practice ----------

export async function logPractice(thread: string, minutes: number | null, note: string | null) {
  await (await db()).runAsync(
    'INSERT INTO practice_log(thread, minutes, note, created_at) VALUES(?, ?, ?, ?)',
    thread,
    minutes,
    note,
    Date.now(),
  );
}

export type PracticeStats = {
  lastAt: number | null;
  daysSince: number | null;
  week: number; // minutes in the last 7 days
  streak: number; // consecutive days up to today/yesterday
  recent: { minutes: number | null; note: string | null; created_at: number }[];
};

export async function practiceStats(thread: string): Promise<PracticeStats> {
  const d = await db();
  const rows = await d.getAllAsync<{ minutes: number | null; note: string | null; created_at: number }>(
    'SELECT minutes, note, created_at FROM practice_log WHERE thread = ? ORDER BY created_at DESC LIMIT 60',
    thread,
  );
  const lastAt = rows[0]?.created_at ?? null;
  const day = (t: number) => Math.floor((new Date(t).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  const days = new Set(rows.map((r) => day(r.created_at)));
  let streak = 0;
  for (let i = days.has(0) ? 0 : -1; days.has(i); i--) streak++;
  return {
    lastAt,
    daysSince: lastAt == null ? null : -day(lastAt),
    week: rows.filter((r) => r.created_at > Date.now() - 7 * 86_400_000).reduce((a, r) => a + (r.minutes ?? 0), 0),
    streak,
    recent: rows.slice(0, 5),
  };
}

// ---------- your own cards ----------

export async function loadCustomThreads(): Promise<Thread[]> {
  const rows = await (await db()).getAllAsync<{ id: string; space: string; title: string; subtitle: string; icon: string; focus: string }>(
    'SELECT * FROM custom_threads ORDER BY created_at',
  );
  const list: Thread[] = rows.map((r) => ({
    id: r.id,
    space: r.space as SpaceId,
    title: r.title,
    subtitle: r.subtitle,
    icon: r.icon,
    focus: r.focus,
    custom: true,
    notebook: r.title,
    area: r.space === 'academics' ? 'coding' : 'side quests',
    panel: r.space === 'academics' ? 'study' : 'practice',
    starters: r.space === 'academics' ? ['Teach me the basics', 'Quiz me', 'Make me a study plan'] : ['Where do I start?', 'Give me a practice plan', 'Log what I learnt'],
  }));
  setCustomThreads(list);
  return list;
}

export async function addCustomThread(space: SpaceId, title: string, icon: string, about: string): Promise<string> {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'topic';
  const id = `${space === 'academics' ? 'study' : 'hobby'}.${slug}-${Date.now().toString(36).slice(-4)}`;
  const focus = `This card is about ${title}.${about ? ` kirthi says: ${about}` : ''} Teach it well from where they are, track their progress, and keep their Notion notes for it current.`;
  await (await db()).runAsync(
    'INSERT INTO custom_threads(id, space, title, subtitle, icon, focus, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)',
    id,
    space,
    title,
    about.slice(0, 60),
    icon,
    focus,
    Date.now(),
  );
  await loadCustomThreads();
  return id;
}

export async function removeCustomThread(id: string) {
  const d = await db();
  await d.runAsync('DELETE FROM custom_threads WHERE id = ?', id);
  await d.runAsync('DELETE FROM messages WHERE coach = ?', id);
  await loadCustomThreads();
}
