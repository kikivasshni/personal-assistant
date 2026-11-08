import { addDays, db, dayKey, kvGet, kvSet } from './db';
import { addTodo, listTodos, setTodoDone, setTodoDue, TodoTask } from './integrations/microsoft';
import { DbSchema, databaseSchema, queryDbRows, upsertDbRow, workspaceMap } from './integrations/notion';
import { isConnected, MICROSOFT } from './integrations/oauth';
import { notifyChange } from './live';

// Tasks: Microsoft To Do is the hub (Samsung Reminder syncs with it), and a
// Notion tasks database is kept in step both ways. Commitments are separate:
// those are time-bound and come with escalating nags.

export type Task = { id: string; title: string; due: string | null; remindAt: string | null; done: boolean };
export type TaskGroups = { today: Task[]; week: Task[]; anytime: Task[] };

function fromTodo(t: TodoTask): Task {
  return {
    id: t.id,
    title: t.title,
    due: t.dueDateTime?.dateTime?.slice(0, 10) ?? null,
    remindAt: t.isReminderOn && t.reminderDateTime ? t.reminderDateTime.dateTime : null,
    done: t.status === 'completed',
  };
}

// Tasks ticked off today, so they can stay visible (struck through) until midnight.
async function doneToday(): Promise<Task[]> {
  const raw = await kvGet('tasks_done_today');
  if (!raw) return [];
  const v = JSON.parse(raw) as { day: string; tasks: Task[] };
  return v.day === dayKey() ? v.tasks : [];
}

async function rememberDone(t: Task, done: boolean) {
  const list = (await doneToday()).filter((x) => x.id !== t.id);
  if (done) list.push({ ...t, done: true });
  await kvSet('tasks_done_today', JSON.stringify({ day: dayKey(), tasks: list }));
}

export async function tasksConnected() {
  return isConnected(MICROSOFT);
}

export async function listTasks(): Promise<Task[]> {
  const open = (await listTodos()).map(fromTodo);
  const done = (await doneToday()).filter((d) => !open.some((o) => o.id === d.id));
  syncNotion(open).catch(() => {});
  return [...open, ...done];
}

export function groupTasks(tasks: Task[]): TaskGroups {
  const today = dayKey();
  const weekEnd = dayKey(addDays(new Date(), 7));
  const g: TaskGroups = { today: [], week: [], anytime: [] };
  for (const t of tasks) {
    if (!t.due) g.anytime.push(t);
    else if (t.due <= today) g.today.push(t);
    else if (t.due <= weekEnd) g.week.push(t);
  }
  const order = (a: Task, b: Task) => Number(a.done) - Number(b.done) || (a.due ?? '').localeCompare(b.due ?? '');
  g.today.sort(order);
  g.week.sort(order);
  g.anytime.sort(order);
  return g;
}

export async function addTask(title: string, dueDay?: string | null, remindAtIso?: string | null): Promise<Task> {
  const t = fromTodo(await addTodo(title, dueDay, remindAtIso));
  notifyChange('tasks');
  mirror(t).catch(() => {});
  return t;
}

export async function setTaskDone(t: Task, done: boolean) {
  await setTodoDone(t.id, done);
  await rememberDone(t, done);
  notifyChange('tasks');
  mirror({ ...t, done }).catch(() => {});
}

export async function moveTask(t: Task, dueDay: string | null) {
  await setTodoDue(t.id, dueDay);
  notifyChange('tasks');
  mirror({ ...t, due: dueDay }).catch(() => {});
}

// ---------- Notion mirror ----------

let schemaMemo: DbSchema | null = null;

// The tasks database: chosen in Settings, or the first one whose name looks like tasks.
export async function notionTasksDb(): Promise<string | null> {
  const chosen = await kvGet('notion_tasks_db');
  if (chosen) return chosen === 'off' ? null : chosen;
  const nodes = await workspaceMap();
  return nodes.find((n) => n.kind === 'database' && /\b(tasks?|to-?dos?)\b/i.test(n.title))?.id ?? null;
}

async function schema(): Promise<DbSchema | null> {
  const id = await notionTasksDb();
  if (!id) return null;
  if (schemaMemo?.id === id) return schemaMemo;
  schemaMemo = await databaseSchema(id);
  return schemaMemo;
}

async function mirror(t: Task) {
  const s = await schema();
  if (!s) return;
  const d = await db();
  const link = await d.getFirstAsync<{ notion_id: string | null }>('SELECT notion_id FROM task_links WHERE ms_id = ?', t.id);
  const notionId = await upsertDbRow(s, { pageId: link?.notion_id, title: t.title, dueIso: t.due, done: t.done });
  await d.runAsync(
    'INSERT INTO task_links(ms_id, notion_id, done) VALUES(?, ?, ?) ON CONFLICT(ms_id) DO UPDATE SET notion_id = excluded.notion_id, done = excluded.done',
    t.id,
    notionId,
    t.done ? 1 : 0,
  );
}

// Runs at most every 10 minutes:
// - To Do tasks missing from Notion are added there
// - tasks finished elsewhere (To Do, Samsung Reminder) are ticked in Notion
// - new unfinished Notion tasks (edited in the last 14 days) are added to To Do
async function syncNotion(open: Task[]) {
  const last = Number((await kvGet('tasks_synced_at')) ?? 0);
  if (Date.now() - last < 10 * 60_000) return;
  await kvSet('tasks_synced_at', String(Date.now()));
  const s = await schema();
  if (!s) return;
  const d = await db();
  const links = await d.getAllAsync<{ ms_id: string; notion_id: string | null; done: number }>('SELECT * FROM task_links');
  const byMs = new Map(links.map((l) => [l.ms_id, l]));
  const openIds = new Set(open.map((t) => t.id));

  for (const t of open) if (!byMs.has(t.id)) await mirror(t);
  for (const l of links) {
    if (!openIds.has(l.ms_id) && !l.done && l.notion_id) {
      await upsertDbRow(s, { pageId: l.notion_id, done: true }).catch(() => {});
      await d.runAsync('UPDATE task_links SET done = 1 WHERE ms_id = ?', l.ms_id);
    }
  }
  const linkedNotion = new Set(links.map((l) => l.notion_id));
  // Commitments are mirrored into the same Notion database; they're not To Do tasks.
  for (const c of await d.getAllAsync<{ notion_id: string }>("SELECT notion_id FROM notion_links WHERE kind = 'commitments'"))
    linkedNotion.add(c.notion_id);
  const since = Date.now() - 14 * 86_400_000;
  for (const row of await queryDbRows(s)) {
    if (row.done || linkedNotion.has(row.id) || row.edited < since || !row.title) continue;
    const t = fromTodo(await addTodo(row.title, row.due));
    await d.runAsync('INSERT OR REPLACE INTO task_links(ms_id, notion_id, done) VALUES(?, ?, 0)', t.id, row.id);
  }
}

// Short labels for the "when" picker: Today, Tomorrow, then weekdays.
export function dueChoices(): { label: string; day: string | null }[] {
  const out: { label: string; day: string | null }[] = [
    { label: 'Today', day: dayKey() },
    { label: 'Tomorrow', day: dayKey(addDays(new Date(), 1)) },
  ];
  for (let i = 2; i < 7; i++) {
    const d = addDays(new Date(), i);
    out.push({ label: d.toLocaleDateString([], { weekday: 'short' }), day: dayKey(d) });
  }
  out.push({ label: 'No date', day: null });
  return out;
}
