import { addDays, dayKey, kvGet, kvSet } from './db';
import { call, workspaceMap } from './integrations/notion';
import { notifyChange } from './live';

// Habits live in kirthi's Notion "habit tracker" database: one row per day,
// a `Date` property, and one checkbox per habit ("drink 4l water", "run /
// cycle"…). Notion is the source of truth: any checkbox column is a habit, so
// adding a column in Notion adds a habit here. A cached copy in kv keeps the
// app instant and usable offline; ticks write straight through to Notion.

export type HabitDay = { day: string; pageId: string; done: Record<string, boolean> };
export type HabitState = { dbId: string; habits: string[]; days: HabitDay[]; fetchedAt: number };

type Schema = { id: string; titleProp: string; dateProp: string | null; habits: string[] };

const CACHE = 'habits_cache';
const WINDOW_DAYS = 35;
let schemaMemo: Schema | null = null;

// The habit database: chosen in Settings, or the first whose name mentions habits.
export async function habitsDbId(): Promise<string | null> {
  const chosen = await kvGet('notion_habits_db');
  if (chosen) return chosen === 'off' ? null : chosen;
  const nodes = await workspaceMap();
  return nodes.find((n) => n.kind === 'database' && /habit/i.test(n.title))?.id ?? null;
}

async function schema(id: string): Promise<Schema> {
  if (schemaMemo?.id === id) return schemaMemo;
  const info = (await call(`/databases/${id}`)) as { properties: Record<string, { type: string }> };
  const props = Object.entries(info.properties);
  schemaMemo = {
    id,
    titleProp: props.find(([, v]) => v.type === 'title')?.[0] ?? 'Name',
    dateProp: props.find(([k, v]) => v.type === 'date' && /date|day/i.test(k))?.[0] ?? props.find(([, v]) => v.type === 'date')?.[0] ?? null,
    habits: props.filter(([, v]) => v.type === 'checkbox').map(([k]) => k),
  };
  return schemaMemo;
}

type Row = { id: string; created_time: string; properties: Record<string, Record<string, unknown>> };

// A row's day: its Date property, else a date mention in the title (how the
// existing rows are named), else the day it was created.
function rowDay(r: Row, s: Schema): string {
  const date = s.dateProp ? (r.properties[s.dateProp]?.date as { start?: string } | null) : null;
  if (date?.start) return date.start.slice(0, 10);
  const title = (r.properties[s.titleProp]?.title ?? []) as { mention?: { date?: { start?: string } } }[];
  const mention = title.find((t) => t.mention?.date?.start)?.mention?.date?.start;
  if (mention) return mention.slice(0, 10);
  return dayKey(new Date(r.created_time));
}

async function fetchState(): Promise<HabitState | null> {
  const id = await habitsDbId();
  if (!id) return null;
  const s = await schema(id);
  const since = dayKey(addDays(new Date(), -WINDOW_DAYS));
  const body: Record<string, unknown> = { page_size: 100, sorts: [{ timestamp: 'created_time', direction: 'descending' }] };
  if (s.dateProp) body.filter = { or: [{ property: s.dateProp, date: { on_or_after: since } }, { timestamp: 'created_time', created_time: { on_or_after: since } }] };
  const res = (await call(`/databases/${id}/query`, { method: 'POST', body: JSON.stringify(body) })) as { results: Row[] };

  // Merge duplicate rows for the same day: a habit counts if any row has it.
  const byDay = new Map<string, HabitDay>();
  for (const r of res.results) {
    const day = rowDay(r, s);
    if (day < since) continue;
    const done: Record<string, boolean> = {};
    for (const h of s.habits) done[h] = !!r.properties[h]?.checkbox;
    const prev = byDay.get(day);
    if (!prev) byDay.set(day, { day, pageId: r.id, done });
    else for (const h of s.habits) prev.done[h] = prev.done[h] || done[h];
  }
  const days = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
  return { dbId: id, habits: s.habits, days, fetchedAt: Date.now() };
}

export async function cachedHabits(): Promise<HabitState | null> {
  const raw = await kvGet(CACHE);
  return raw ? (JSON.parse(raw) as HabitState) : null;
}

async function saveCache(state: HabitState) {
  await kvSet(CACHE, JSON.stringify(state));
}

/**
 * The habit state, from cache when it's fresh enough, otherwise from Notion.
 * Returns null when no habit database is shared with the integration.
 */
export async function loadHabits(maxAgeMs = 60_000): Promise<HabitState | null> {
  const cached = await cachedHabits();
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) return cached;
  const fresh = await fetchState();
  if (fresh) await saveCache(fresh);
  return fresh ?? cached;
}

export function dayOf(state: HabitState, day = dayKey()): HabitDay | undefined {
  return state.days.find((d) => d.day === day);
}

// Days in a row a habit was done, counting back from today (or from
// yesterday if today isn't ticked yet, so a streak isn't "broken" at 8am).
export function streak(state: HabitState, habit: string): number {
  let d = new Date();
  if (!dayOf(state, dayKey(d))?.done[habit]) d = addDays(d, -1);
  let n = 0;
  while (dayOf(state, dayKey(d))?.done[habit]) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// Matches what a coach or a person says ("water", "ran", "gym") to a habit.
export function matchHabit(habits: string[], said: string): string | null {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const n = norm(said);
  if (!n) return null;
  return (
    habits.find((h) => norm(h) === n) ??
    habits.find((h) => norm(h).includes(n) || n.includes(norm(h))) ??
    habits.find((h) => norm(h).split(' ').some((w) => w.length > 3 && n.split(' ').includes(w))) ??
    null
  );
}

async function ensureDayRow(state: HabitState, day: string): Promise<string> {
  const hit = dayOf(state, day);
  if (hit) return hit.pageId;
  const s = await schema(state.dbId);
  const properties: Record<string, unknown> = {
    // Same shape as the rows already there: the title is a date mention.
    [s.titleProp]: { title: [{ type: 'mention', mention: { type: 'date', date: { start: day } } }] },
  };
  if (s.dateProp) properties[s.dateProp] = { date: { start: day } };
  const page = (await call('/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: state.dbId }, properties }) })) as { id: string };
  return page.id;
}

/** Ticks or unticks a habit for a day (default today), in Notion and the cache. */
export async function setHabit(habit: string, done: boolean, day = dayKey()): Promise<HabitState> {
  const state = (await loadHabits(5 * 60_000)) ?? null;
  if (!state) throw new Error('No habit tracker found in Notion. Share your "habit tracker" database with the Kairos integration, then scan Notion again.');
  if (!state.habits.includes(habit)) throw new Error(`"${habit}" isn't a habit in your tracker.`);

  // Optimistic: show it straight away, then write to Notion.
  const before = JSON.stringify(state);
  let row = dayOf(state, day);
  if (!row) {
    row = { day, pageId: '', done: Object.fromEntries(state.habits.map((h) => [h, false])) };
    state.days.unshift(row);
    state.days.sort((a, b) => b.day.localeCompare(a.day));
  }
  row.done[habit] = done;
  await saveCache(state);
  notifyChange('habits');

  try {
    const pageId = row.pageId || (await ensureDayRow({ ...state, days: state.days.filter((d) => d.pageId) }, day));
    row.pageId = pageId;
    await call(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties: { [habit]: { checkbox: done } } }) });
    await saveCache(state);
    return state;
  } catch (e) {
    await kvSet(CACHE, before);
    notifyChange('habits');
    throw e;
  }
}

/** One line for coach context, from the cache (no network). */
export async function habitsContext(): Promise<string> {
  const state = await cachedHabits();
  if (!state?.habits.length) return '';
  const today = dayOf(state);
  const done = state.habits.filter((h) => today?.done[h]);
  const open = state.habits.filter((h) => !today?.done[h]);
  const streaks = state.habits
    .map((h) => [h, streak(state, h)] as const)
    .filter(([, n]) => n >= 2)
    .map(([h, n]) => `${h} ${n}d`);
  return `Habits today (Notion habit tracker): done ${done.join(', ') || 'none yet'}; still open ${open.join(', ') || 'none'}.${
    streaks.length ? ` Streaks: ${streaks.join(', ')}.` : ''
  } Use log_habit when kirthi reports doing one.`;
}
