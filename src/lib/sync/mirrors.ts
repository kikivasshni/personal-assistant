import { resolve } from '@/data/spaces';
import { setCommitmentStatus } from '../commitments';
import { addDays, Commitment, db, dayKey, Desire, Food, kvSet, Mood, parseDayKey, Song, Workout } from '../db';
import { databaseSchema, DbSchema, NotionNode } from '../integrations/notion';
import { guessTrainingType } from '../integrations/secondBrain';
import { MOODS } from '../moods';
import { notionTasksDb } from '../tasks';
import { Canon, day, Mirror, num, Page, r1, read, s0, sel, ttl, txt } from './engine';

// What syncs where. Each entry pairs a local table with one of kirthi's
// Notion databases (found by title, so renaming a database's case is fine).

const byTitle = (re: RegExp) => (nodes: NotionNode[]) => nodes.find((n) => n.kind === 'database' && re.test(n.title.trim()))?.id;

const dayOf = (ms: number) => dayKey(new Date(ms));
const ymd = (s: string | null) => (s ? s.slice(0, 10) : null);

// A timestamp for a day: keeps the original time if the day didn't change,
// otherwise noon on the new day (so it sits squarely inside that day).
function moveToDay(createdAt: number, newDay: string): number {
  if (dayOf(createdAt) === newDay) return createdAt;
  return parseDayKey(newDay).getTime() + 12 * 3_600_000;
}
const atDay = (d: string) => (d === dayKey() ? Date.now() : parseDayKey(d).getTime() + 12 * 3_600_000);

// ---------- food ↔ food & health log ----------

const food: Mirror = {
  kind: 'food',
  tables: ['food_log'],
  findDb: byTitle(/^food (&|and) health log$/i),
  localRows: async () =>
    (await (await db()).getAllAsync<Food>('SELECT * FROM food_log')).map((f) => ({
      id: f.id,
      canon: {
        name: s0(f.description) ?? 'Meal',
        day: dayOf(f.created_at),
        kcal: r1(f.kcal),
        protein: r1(f.protein),
        carbs: r1(f.carbs),
        fat: r1(f.fat),
        fibre: r1(f.fibre),
        note: s0(f.note),
      },
      createExtra: { Source: sel(f.photo_uri ? 'photo' : 'text') },
    })),
  toProps: (c) => ({
    Name: ttl(String(c.name)),
    Date: day(c.day as string),
    Calories: num(c.kcal as number | null),
    Protein: num(c.protein as number | null),
    Carbs: num(c.carbs as number | null),
    Fats: num(c.fat as number | null),
    Fibre: num(c.fibre as number | null),
    'PCOS notes': txt(c.note as string | null),
  }),
  fromPage: (p) => {
    const name = read.title(p);
    const d = ymd(read.date(p, 'Date'));
    if (!name || !d) return null;
    return {
      name,
      day: d,
      kcal: r1(read.num(p, 'Calories')),
      protein: r1(read.num(p, 'Protein')),
      carbs: r1(read.num(p, 'Carbs')),
      fat: r1(read.num(p, 'Fats')),
      fibre: r1(read.num(p, 'Fibre')),
      note: s0(read.text(p, 'PCOS notes')),
    };
  },
  matchKey: (c) => `${String(c.name).toLowerCase()}|${c.day}`,
  applyLocal: async (id, c) => {
    const d = await db();
    const cur = await d.getFirstAsync<Food>('SELECT * FROM food_log WHERE id = ?', id);
    if (!cur) return;
    await d.runAsync(
      'UPDATE food_log SET description = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, fibre = ?, note = ?, created_at = ? WHERE id = ?',
      c.name,
      c.kcal,
      c.protein,
      c.carbs,
      c.fat,
      c.fibre,
      c.note,
      moveToDay(cur.created_at, String(c.day)),
      id,
    );
  },
  insertLocal: async (c) =>
    (
      await (await db()).runAsync(
        'INSERT INTO food_log(description, kcal, protein, carbs, fat, fibre, note, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
        c.name,
        c.kcal,
        c.protein,
        c.carbs,
        c.fat,
        c.fibre,
        c.note,
        atDay(String(c.day)),
      )
    ).lastInsertRowId,
  deleteLocal: async (id) => {
    await (await db()).runAsync('DELETE FROM food_log WHERE id = ?', id);
  },
};

// ---------- workouts ↔ training log ----------

const workouts: Mirror = {
  kind: 'workouts',
  tables: ['workouts'],
  findDb: byTitle(/^training log$/i),
  localRows: async () =>
    (await (await db()).getAllAsync<Workout>('SELECT * FROM workouts')).map((w) => ({
      id: w.id,
      canon: { title: s0(w.title) ?? 'Workout', day: dayOf(w.created_at), minutes: r1(w.minutes), notes: s0(w.details) },
      createExtra: { Type: sel(guessTrainingType(w.title)) },
    })),
  toProps: (c) => ({
    Session: ttl(String(c.title)),
    Date: day(c.day as string),
    'Duration min': num(c.minutes as number | null),
    Notes: txt(c.notes as string | null),
  }),
  fromPage: (p) => {
    const title = read.title(p);
    const d = ymd(read.date(p, 'Date'));
    if (!title || !d) return null;
    return { title, day: d, minutes: r1(read.num(p, 'Duration min')), notes: s0(read.text(p, 'Notes')) };
  },
  matchKey: (c) => `${String(c.title).toLowerCase()}|${c.day}`,
  applyLocal: async (id, c) => {
    const d = await db();
    const cur = await d.getFirstAsync<Workout>('SELECT * FROM workouts WHERE id = ?', id);
    if (!cur) return;
    await d.runAsync(
      'UPDATE workouts SET title = ?, minutes = ?, details = ?, created_at = ? WHERE id = ?',
      c.title,
      c.minutes,
      c.notes,
      moveToDay(cur.created_at, String(c.day)),
      id,
    );
  },
  insertLocal: async (c) =>
    (
      await (await db()).runAsync(
        'INSERT INTO workouts(title, minutes, details, source, created_at) VALUES(?, ?, ?, ?, ?)',
        c.title,
        c.minutes,
        c.notes,
        'notion',
        atDay(String(c.day)),
      )
    ).lastInsertRowId,
  deleteLocal: async (id) => {
    await (await db()).runAsync('DELETE FROM workouts WHERE id = ?', id);
  },
};

// ---------- moods ↔ journal ----------
// One journal row per day with a "mood: good" tag. Journal entries you write
// yourself (no mood tag) are left alone.

const moodLabel = (v: number) => MOODS[Math.min(5, Math.max(1, Math.round(v))) - 1].label.toLowerCase();
const moodValue = (label: string) => MOODS.find((m) => m.label.toLowerCase() === label)?.value ?? null;

const moods: Mirror = {
  kind: 'moods',
  tables: ['moods'],
  findDb: byTitle(/^journal$/i),
  localRows: async () =>
    (await (await db()).getAllAsync<Mood>('SELECT * FROM moods')).map((m) => ({
      id: m.id,
      canon: { day: dayOf(m.created_at), mood: moodLabel(m.mood), note: s0(m.note) },
    })),
  toProps: (c) => ({
    Name: ttl(`feeling ${c.mood}`),
    date: day(c.day as string),
    tags: { multi_select: [{ name: `mood: ${c.mood}` }] },
    summary: txt(c.note as string | null),
  }),
  fromPage: (p) => {
    const tag = read.multi(p, 'tags').find((t) => t.startsWith('mood: '));
    const d = ymd(read.date(p, 'date'));
    const label = tag?.slice(6).trim().toLowerCase();
    if (!label || !d || moodValue(label) == null) return null;
    return { day: d, mood: label, note: s0(read.text(p, 'summary')) };
  },
  matchKey: (c) => String(c.day),
  applyLocal: async (id, c) => {
    const d = await db();
    const cur = await d.getFirstAsync<Mood>('SELECT * FROM moods WHERE id = ?', id);
    if (!cur) return;
    await d.runAsync(
      'UPDATE moods SET mood = ?, note = ?, created_at = ? WHERE id = ?',
      moodValue(String(c.mood)),
      c.note,
      moveToDay(cur.created_at, String(c.day)),
      id,
    );
  },
  insertLocal: async (c) =>
    (await (await db()).runAsync('INSERT INTO moods(mood, note, created_at) VALUES(?, ?, ?)', moodValue(String(c.mood)), c.note, atDay(String(c.day))))
      .lastInsertRowId,
  deleteLocal: async (id) => {
    await (await db()).runAsync('DELETE FROM moods WHERE id = ?', id);
  },
};

// ---------- facts (shared memory) ↔ profile ----------
// The "Basics" row is your profile text, synced separately (see index.ts).

export const PROFILE_ROW = /^basics$/i;

const facts: Mirror = {
  kind: 'facts',
  tables: ['facts'],
  findDb: byTitle(/^profile$/i),
  localRows: async () =>
    (await (await db()).getAllAsync<{ id: number; text: string }>('SELECT id, text FROM facts')).map((f) => ({
      id: f.id,
      canon: { text: s0(f.text) ?? '' },
    })),
  toProps: (c) => {
    const t = String(c.text);
    return { Name: ttl(t.length > 80 ? `${t.slice(0, 77)}…` : t), Context: txt(t) };
  },
  fromPage: (p) => {
    const title = read.title(p);
    if (PROFILE_ROW.test(title)) return null;
    const text = s0(read.text(p, 'Context')) ?? s0(title);
    return text ? { text } : null;
  },
  matchKey: (c) => String(c.text).toLowerCase(),
  applyLocal: async (id, c) => {
    await (await db()).runAsync('UPDATE facts SET text = ? WHERE id = ?', c.text, id);
  },
  insertLocal: async (c) =>
    (await (await db()).runAsync('INSERT INTO facts(text, coach, created_at) VALUES(?, ?, ?)', c.text, null, Date.now())).lastInsertRowId,
  deleteLocal: async (id) => {
    await (await db()).runAsync('DELETE FROM facts WHERE id = ?', id);
  },
};

// ---------- commitments → tasks ----------
// Commitments appear in your Notion tasks with their time. Ticking one in
// Notion completes it in the app (and cancels its nags). Times are set in the
// app, where the reminders live.

let tasksSchema: DbSchema | null = null;
async function taskSchema(): Promise<DbSchema | null> {
  const id = await notionTasksDb();
  if (!id) return null;
  if (tasksSchema?.id !== id) tasksSchema = await databaseSchema(id);
  return tasksSchema;
}

const pad = (n: number) => String(n).padStart(2, '0');
// "2026-11-09T20:00" in phone-local time: what both sides compare.
const localMinute = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// The same, with the phone's UTC offset, for Notion.
const withOffset = (minute: string) => {
  const off = -new Date(`${minute}:00`).getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${minute}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
};

const commitments: Mirror = {
  kind: 'commitments',
  tables: ['commitments'],
  findDb: async () => (await taskSchema())?.id,
  localRows: async () => {
    const recent = addDays(new Date(), -7).getTime();
    return (await (await db()).getAllAsync<Commitment>('SELECT * FROM commitments')).map((c) => ({
      id: c.id,
      canon: { title: s0(c.title) ?? 'Commitment', due: localMinute(c.due_at), done: c.status === 'done' },
      // Old, finished commitments aren't back-filled into Notion.
      noCreate: c.status !== 'open' && c.due_at < recent,
    }));
  },
  toProps: async (c) => {
    const s = (await taskSchema())!;
    const props: Record<string, unknown> = { [s.titleProp]: ttl(String(c.title)) };
    if (s.dateProp) props[s.dateProp] = { date: { start: withOffset(String(c.due)) } };
    if (s.doneProp?.type === 'checkbox') props[s.doneProp.name] = { checkbox: !!c.done };
    if (s.doneProp?.type === 'status') props[s.doneProp.name] = { status: { name: c.done ? s.doneProp.doneValue : s.doneProp.openValue } };
    return props;
  },
  fromPage: (p) => {
    const s = tasksSchema;
    if (!s?.dateProp) return null;
    const start = read.date(p, s.dateProp);
    if (!start || !start.includes('T')) return null; // all-day items are tasks, not commitments
    const title = read.title(p);
    if (!title) return null;
    let done = false;
    if (s.doneProp?.type === 'checkbox') done = read.checkbox(p, s.doneProp.name);
    if (s.doneProp?.type === 'status') done = (p.properties[s.doneProp.name]?.status as { name?: string } | null)?.name === s.doneProp.doneValue;
    return { title, due: localMinute(Date.parse(start)), done };
  },
  matchKey: (c) => `${String(c.title).toLowerCase()}|${c.due}`,
  applyLocal: async (id, c) => {
    const d = await db();
    const cur = await d.getFirstAsync<Commitment>('SELECT * FROM commitments WHERE id = ?', id);
    if (!cur) return;
    if (c.title !== cur.title) await d.runAsync('UPDATE commitments SET title = ? WHERE id = ?', c.title, id);
    if (c.done && cur.status !== 'done') await setCommitmentStatus(id, 'done');
    else if (!c.done && cur.status === 'done') await d.runAsync("UPDATE commitments SET status = 'open', done_at = NULL WHERE id = ?", id);
  },
  // No insertLocal: new Notion tasks belong to the tasks sync (To Do).
  // No deleteLocal: deleting it in Notion just stops syncing it.
};

// ---------- desires ----------

const DESIRE_STATUS: Record<Desire['status'], string> = { pending: 'assuming', manifested: 'manifested', released: 'released' };
const desireStatus = (s: string | null): Desire['status'] =>
  s === 'manifested' ? 'manifested' : s === 'released' ? 'released' : 'pending';

const desires: Mirror = {
  kind: 'desires',
  tables: ['desires'],
  findDb: byTitle(/^desires$/i),
  localRows: async () =>
    (await (await db()).getAllAsync<Desire>('SELECT * FROM desires')).map((x) => ({
      id: x.id,
      canon: {
        title: s0(x.title) ?? 'Desire',
        status: DESIRE_STATUS[x.status],
        detail: s0(x.detail),
        scene: s0(x.scene),
        story: s0(x.story),
        since: dayOf(x.created_at),
        manifested: x.manifested_at ? dayOf(x.manifested_at) : null,
      },
    })),
  toProps: (c) => ({
    Name: ttl(String(c.title)),
    Status: sel(c.status as string),
    Detail: txt(c.detail as string | null),
    Scene: txt(c.scene as string | null),
    Story: txt(c.story as string | null),
    Since: day(c.since as string),
    Manifested: day(c.manifested as string | null),
  }),
  fromPage: (p) => {
    const title = read.title(p);
    if (!title) return null;
    const status = DESIRE_STATUS[desireStatus(read.select(p, 'Status'))];
    return {
      title,
      status,
      detail: s0(read.text(p, 'Detail')),
      scene: s0(read.text(p, 'Scene')),
      story: s0(read.text(p, 'Story')),
      since: ymd(read.date(p, 'Since')) ?? dayKey(),
      manifested: ymd(read.date(p, 'Manifested')) ?? (status === 'manifested' ? dayKey() : null),
    };
  },
  matchKey: (c) => String(c.title).toLowerCase(),
  applyLocal: async (id, c) => {
    const d = await db();
    const cur = await d.getFirstAsync<Desire>('SELECT * FROM desires WHERE id = ?', id);
    if (!cur) return;
    const status = desireStatus(c.status as string);
    await d.runAsync(
      'UPDATE desires SET title = ?, detail = ?, scene = ?, story = ?, status = ?, created_at = ?, manifested_at = ? WHERE id = ?',
      c.title,
      c.detail,
      c.scene,
      c.story,
      status,
      moveToDay(cur.created_at, String(c.since)),
      status === 'manifested' ? (cur.manifested_at && dayOf(cur.manifested_at) === c.manifested ? cur.manifested_at : atDay(String(c.manifested ?? dayKey()))) : null,
      id,
    );
    await kvSet('affirmations_until', '0'); // new wording, new affirmations
  },
  insertLocal: async (c) => {
    const status = desireStatus(c.status as string);
    const r = await (await db()).runAsync(
      'INSERT INTO desires(title, detail, scene, story, status, created_at, manifested_at) VALUES(?, ?, ?, ?, ?, ?, ?)',
      c.title,
      c.detail,
      c.scene,
      c.story,
      status,
      atDay(String(c.since)),
      status === 'manifested' ? atDay(String(c.manifested ?? dayKey())) : null,
    );
    await kvSet('affirmations_until', '0');
    return r.lastInsertRowId;
  },
  deleteLocal: async (id) => {
    await (await db()).runAsync('DELETE FROM desires WHERE id = ?', id);
  },
};

// ---------- songs ----------

const songStatus = (s: string | null): Song['status'] => (s === 'wishlist' ? 'wishlist' : s === 'learned' ? 'learned' : 'learning');

const songs: Mirror = {
  kind: 'songs',
  tables: ['songs'],
  findDb: byTitle(/^songs$/i),
  localRows: async () =>
    (await (await db()).getAllAsync<Song>('SELECT * FROM songs')).map((x) => ({
      id: x.id,
      canon: { title: s0(x.title) ?? 'Song', artist: s0(x.artist), status: x.status, notes: s0(x.notes) },
    })),
  toProps: (c) => ({ Name: ttl(String(c.title)), Artist: txt(c.artist as string | null), Status: sel(c.status as string), Notes: txt(c.notes as string | null) }),
  fromPage: (p) => {
    const title = read.title(p);
    if (!title) return null;
    return { title, artist: s0(read.text(p, 'Artist')), status: songStatus(read.select(p, 'Status')), notes: s0(read.text(p, 'Notes')) };
  },
  matchKey: (c) => `${String(c.title).toLowerCase()}|${String(c.artist ?? '').toLowerCase()}`,
  applyLocal: async (id, c) => {
    await (await db()).runAsync(
      'UPDATE songs SET title = ?, artist = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?',
      c.title,
      c.artist,
      c.status,
      c.notes,
      Date.now(),
      id,
    );
  },
  insertLocal: async (c) =>
    (
      await (await db()).runAsync(
        'INSERT INTO songs(title, artist, status, notes, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)',
        c.title,
        c.artist,
        c.status,
        c.notes,
        Date.now(),
        Date.now(),
      )
    ).lastInsertRowId,
  deleteLocal: async (id) => {
    await (await db()).runAsync('DELETE FROM songs WHERE id = ?', id);
  },
};

// ---------- practice ----------

const cardName = (thread: string) => {
  try {
    return resolve(thread).title;
  } catch {
    return thread;
  }
};

const practice: Mirror = {
  kind: 'practice',
  tables: ['practice_log'],
  findDb: byTitle(/^practice log$/i),
  localRows: async () =>
    (await (await db()).getAllAsync<{ id: number; thread: string; minutes: number | null; note: string | null; created_at: number }>('SELECT * FROM practice_log')).map(
      (x) => ({ id: x.id, canon: { name: cardName(x.thread), day: dayOf(x.created_at), minutes: r1(x.minutes), note: s0(x.note) } }),
    ),
  toProps: (c) => ({ Name: ttl(String(c.name)), Date: day(c.day as string), Minutes: num(c.minutes as number | null), Note: txt(c.note as string | null) }),
  fromPage: (p) => {
    const name = read.title(p);
    const d = ymd(read.date(p, 'Date'));
    if (!name || !d) return null;
    return { name, day: d, minutes: r1(read.num(p, 'Minutes')), note: s0(read.text(p, 'Note')) };
  },
  matchKey: (c) => `${String(c.name).toLowerCase()}|${c.day}|${c.minutes}`,
  applyLocal: async (id, c) => {
    const d = await db();
    const cur = await d.getFirstAsync<{ created_at: number }>('SELECT created_at FROM practice_log WHERE id = ?', id);
    if (!cur) return;
    await d.runAsync('UPDATE practice_log SET minutes = ?, note = ?, created_at = ? WHERE id = ?', c.minutes, c.note, moveToDay(cur.created_at, String(c.day)), id);
  },
  // No insertLocal: a session needs to know which card it belongs to.
  deleteLocal: async (id) => {
    await (await db()).runAsync('DELETE FROM practice_log WHERE id = ?', id);
  },
};

// ---------- cycle ----------

const cycle: Mirror = {
  kind: 'cycle',
  tables: ['cycle_log'],
  findDb: byTitle(/^cycle log$/i),
  localRows: async () =>
    (await (await db()).getAllAsync<{ id: number; day: string; kind: string; note: string | null }>('SELECT * FROM cycle_log')).map((x) => ({
      id: x.id,
      canon: { day: x.day, kind: x.kind, note: s0(x.note) },
    })),
  toProps: (c) => ({
    Name: ttl(c.kind === 'period' ? 'period' : String(c.note ?? 'symptom')),
    Date: day(c.day as string),
    Kind: sel(c.kind as string),
    Note: txt(c.note as string | null),
  }),
  fromPage: (p) => {
    const d = ymd(read.date(p, 'Date'));
    const kind = read.select(p, 'Kind') === 'symptom' ? 'symptom' : read.select(p, 'Kind') === 'period' ? 'period' : null;
    if (!d || !kind) return null;
    return { day: d, kind, note: s0(read.text(p, 'Note')) ?? (kind === 'symptom' ? s0(read.title(p)) : null) };
  },
  matchKey: (c) => `${c.kind}|${c.day}|${String(c.note ?? '').toLowerCase()}`,
  applyLocal: async (id, c) => {
    await (await db()).runAsync('UPDATE OR IGNORE cycle_log SET day = ?, kind = ?, note = ? WHERE id = ?', c.day, c.kind, c.note, id);
  },
  insertLocal: async (c) => {
    const d = await db();
    const r = await d.runAsync('INSERT OR IGNORE INTO cycle_log(day, kind, note, created_at) VALUES(?, ?, ?, ?)', c.day, c.kind, c.note, Date.now());
    return r.changes ? r.lastInsertRowId : null;
  },
  deleteLocal: async (id) => {
    await (await db()).runAsync('DELETE FROM cycle_log WHERE id = ?', id);
  },
};

// ---------- transactions ↔ financial ledger ----------
// Statements are imported in the app; Notion edits to category, amount or
// date come back. Deleting a row in Notion just stops syncing it.

const ledger: Mirror = {
  kind: 'ledger',
  tables: ['transactions'],
  findDb: byTitle(/^financial ledger$/i),
  localRows: async () =>
    (
      await (await db()).getAllAsync<{ id: number; date: string; merchant: string; amount: number; category: string | null; note: string | null }>(
        'SELECT id, date, merchant, amount, category, note FROM transactions',
      )
    ).map((t) => ({
      id: t.id,
      canon: {
        name: t.note ? `${t.merchant} · ${t.note}` : t.merchant,
        day: t.date.slice(0, 10),
        amount: Math.round(t.amount * 100) / 100,
        category: t.category ?? 'Other',
      },
      createExtra: { Account: sel('DBS') },
    })),
  toProps: (c) => ({
    Name: ttl(String(c.name)),
    Date: day(c.day as string),
    Amount: num(c.amount as number),
    Category: sel(c.category as string),
    Month: txt(String(c.day).slice(0, 7)),
  }),
  fromPage: (p) => {
    const name = read.title(p);
    const d = ymd(read.date(p, 'Date'));
    const amount = read.num(p, 'Amount');
    if (!name || !d || amount == null) return null;
    return { name, day: d, amount: Math.round(amount * 100) / 100, category: read.select(p, 'Category') ?? 'Other' };
  },
  matchKey: (c) => `${String(c.name).toLowerCase()}|${c.day}|${c.amount}`,
  applyLocal: async (id, c) => {
    await (await db()).runAsync('UPDATE transactions SET date = ?, amount = ?, category = ?, needs_review = 0 WHERE id = ?', c.day, c.amount, c.category, id);
  },
};

export const MIRRORS: Mirror[] = [food, workouts, moods, facts, commitments, desires, songs, practice, cycle, ledger];

export type { Canon, Page };
