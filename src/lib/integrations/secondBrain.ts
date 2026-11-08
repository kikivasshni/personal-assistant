import { kvGet, kvSet } from '../db';
import { call, markdownToBlocks, NotionNode, plain, rich, workspaceMap } from './notion';

// kirthi's Notion "second brain" (PARA). Its structure, learnt from the workspace:
//
//   areas      (database)  health and diet, coding, finance, fitness, side quests, personal
//   notebook   (database)  one row per subject, e.g. "AWS", "Terraform Associate"
//   notes      (database)  one row per topic, linked to a notebook via the `notebook` relation
//   tasks      (database)  Name, due date, complete (checkbox), areas, projects
//   Food & Health Log, Training Log, financial ledger, Spending Categories (logs)
//
// Notes are database rows, not sub-pages, so a new note is a row in `notes`
// linked to its notebook, and a new subject is a new `notebook` row.

type Dbs = {
  notes?: string;
  notebook?: string;
  areas?: string;
  food?: string;
  training?: string;
  ledger?: string;
  budgets?: string;
};

// How kirthi writes study notes (taken from their AWS SAP-C03 notebook).
export const NOTE_STYLE = `Match kirthi's note style exactly:
- Numbered "## 1. Topic" sections separated by "---" dividers, "###" subsections.
- Dense nested bullets with bold labels: "- **Purpose:** ...", "- **Use cases:** ...".
- Comparison tables (| A | B |) whenever services or options are compared.
- Exam traps as quote callouts: "> ⚠️ **Key Gotcha (short name):** explanation and the fix."
- Architecture flows as \`\`\`txt ASCII diagrams, followed by a numbered walkthrough.
- No intro fluff; precise facts, numbers and limits.`;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function dbs(): Promise<Dbs> {
  const nodes = await workspaceMap();
  const db = (re: RegExp) => nodes.find((n) => n.kind === 'database' && re.test(n.title.trim()))?.id;
  return {
    notes: db(/^notes$/i),
    notebook: db(/^notebooks?$/i),
    areas: db(/^areas$/i),
    food: db(/^food (&|and) health log$/i),
    training: db(/^training log$/i),
    ledger: db(/^financial ledger$/i),
    budgets: db(/^spending categories$/i),
  };
}

export async function hasSecondBrain(): Promise<boolean> {
  const d = await dbs().catch(() => ({}) as Dbs);
  return !!(d.notes && d.notebook);
}

type Row = { id: string; url: string; last_edited_time: string; properties: Record<string, Record<string, unknown>> };

async function query(dbId: string, body: Record<string, unknown> = {}): Promise<Row[]> {
  const out: Row[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 5; i++) {
    const r = (await call(`/databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify({ page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) }),
    })) as { results: Row[]; has_more: boolean; next_cursor: string | null };
    out.push(...r.results);
    if (!r.has_more || !r.next_cursor) break;
    cursor = r.next_cursor;
  }
  return out;
}

const title = (r: Row) => plain(Object.values(r.properties).find((p) => p.type === 'title')?.title);
const id = (r: Row) => r.id.replace(/-/g, '');

// ---------- notebooks and notes ----------

export type Notebook = { id: string; name: string; url: string };

export async function notebooks(): Promise<Notebook[]> {
  const d = await dbs();
  if (!d.notebook) return [];
  const rows = await query(d.notebook, { filter: { property: 'archive', checkbox: { equals: false } } }).catch(() => query(d.notebook!));
  return rows.map((r) => ({ id: id(r), name: title(r), url: r.url })).filter((n) => n.name);
}

export function matchNotebook(list: Notebook[], name: string): Notebook | undefined {
  const n = norm(name);
  return list.find((b) => norm(b.name) === n) ?? list.find((b) => norm(b.name).includes(n) || n.includes(norm(b.name)));
}

async function areaId(name: string | undefined): Promise<string | null> {
  const d = await dbs();
  if (!d.areas || !name) return null;
  const rows = await query(d.areas);
  return rows.map((r) => ({ id: id(r), name: title(r) })).find((a) => norm(a.name) === norm(name))?.id ?? null;
}

// Finds a notebook by name, or creates it (linked to an area like "side quests").
export async function ensureNotebook(name: string, area?: string): Promise<Notebook> {
  const hit = matchNotebook(await notebooks(), name);
  if (hit) return hit;
  const d = await dbs();
  if (!d.notebook) throw new Error('No "notebook" database found in Notion. Scan Notion again under You → Notion.');
  const a = await areaId(area);
  const page = (await call('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: d.notebook },
      properties: { Name: { title: rich(name) }, ...(a ? { areas: { relation: [{ id: a }] } } : {}) },
      children: markdownToBlocks('## notes\n---'),
    }),
  })) as { id: string; url: string };
  return { id: page.id.replace(/-/g, ''), name, url: page.url };
}

export type NoteRef = { id: string; title: string; url: string; status: string | null; edited: string };

export async function notesIn(notebookId: string): Promise<NoteRef[]> {
  const d = await dbs();
  if (!d.notes) return [];
  const rows = await query(d.notes, {
    filter: { property: 'notebook', relation: { contains: notebookId } },
    sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
  });
  return rows.map((r) => ({
    id: id(r),
    title: title(r),
    url: r.url,
    status: (r.properties.status?.status as { name?: string } | null)?.name ?? null,
    edited: r.last_edited_time,
  }));
}

// Writes a study/hobby note the way kirthi does: a row in `notes` linked to the
// notebook. Appends if a note with the same title already exists there.
export async function saveNote(input: { notebook: string; title: string; markdown: string; area?: string }): Promise<{ url: string; created: boolean; notebook: string }> {
  const d = await dbs();
  if (!d.notes) throw new Error('No "notes" database found in Notion. Scan Notion again under You → Notion.');
  const book = await ensureNotebook(input.notebook, input.area);
  const existing = (await notesIn(book.id)).find((n) => norm(n.title) === norm(input.title));
  const blocks = markdownToBlocks(input.markdown);
  if (existing) {
    for (let i = 0; i < blocks.length; i += 90)
      await call(`/blocks/${existing.id}/children`, { method: 'PATCH', body: JSON.stringify({ children: blocks.slice(i, i + 90) }) });
    return { url: existing.url, created: false, notebook: book.name };
  }
  const page = (await call('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: d.notes },
      properties: { Name: { title: rich(input.title) }, notebook: { relation: [{ id: book.id }] } },
      children: blocks.slice(0, 90),
    }),
  })) as { id: string; url: string };
  for (let i = 90; i < blocks.length; i += 90)
    await call(`/blocks/${page.id}/children`, { method: 'PATCH', body: JSON.stringify({ children: blocks.slice(i, i + 90) }) });
  return { url: page.url, created: true, notebook: book.name };
}

// Context for a card: its notebook and the notes already in it.
export async function notebookContext(name: string): Promise<string> {
  const book = matchNotebook(await notebooks(), name);
  if (!book) return `No "${name}" notebook yet. The first save_note for this card creates it.`;
  const notes = await notesIn(book.id);
  return `Notebook "${book.name}" has ${notes.length} notes: ${notes.map((n) => `${n.title} (${n.id.slice(0, 8)})`).join('; ') || 'none yet'}.`;
}

// ---------- logs ----------

async function insertRow(dbId: string | undefined, properties: Record<string, unknown>) {
  if (!dbId) return;
  await call('/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: dbId }, properties }) });
}

const num = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : { number: Math.round(v * 10) / 10 });
const text = (s: string | null | undefined) => ({ rich_text: s ? rich(s) : [] });

export async function logFoodToNotion(m: {
  name: string;
  day: string;
  kcal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fibre?: number | null;
  items?: string | null;
  note?: string | null;
  source: 'photo' | 'text';
}) {
  const d = await dbs();
  await insertRow(d.food, {
    Name: { title: rich(m.name) },
    Date: { date: { start: m.day } },
    Calories: num(m.kcal),
    Protein: num(m.protein),
    Carbs: num(m.carbs),
    Fats: num(m.fat),
    Fibre: num(m.fibre),
    Items: text(m.items),
    'PCOS notes': text(m.note),
    Source: { select: { name: m.source } },
  });
}

const TRAINING_TYPES = ['Easy', 'Long', 'Tempo', 'Intervals', 'Race', 'Strength'];

// The training log's Type for a session, from its title.
export function guessTrainingType(title: string, type?: string | null): string {
  if (type && TRAINING_TYPES.includes(type)) return type;
  if (!/run|km|jog/i.test(title)) return 'Strength';
  if (/long/i.test(title)) return 'Long';
  if (/tempo/i.test(title)) return 'Tempo';
  if (/interval/i.test(title)) return 'Intervals';
  return 'Easy';
}

export async function logTrainingToNotion(w: { title: string; day: string; minutes?: number | null; distanceKm?: number | null; type?: string | null; notes?: string | null }) {
  const d = await dbs();
  const guess = guessTrainingType(w.title, w.type);
  await insertRow(d.training, {
    Session: { title: rich(w.title) },
    Date: { date: { start: w.day } },
    Type: { select: { name: guess } },
    'Duration min': num(w.minutes),
    'Distance km': num(w.distanceKm),
    Notes: text(w.notes),
  });
}

// Pushes categorised transactions into the financial ledger, once per transaction.
export async function pushToLedger(txns: { id: number; date: string; merchant: string; amount: number; category: string | null; note: string | null }[]): Promise<number> {
  const d = await dbs();
  if (!d.ledger) return 0;
  const done = new Set<string>(JSON.parse((await kvGet('ledger_pushed')) ?? '[]'));
  let n = 0;
  for (const t of txns) {
    if (done.has(String(t.id))) continue;
    await insertRow(d.ledger, {
      Name: { title: rich(t.note ? `${t.merchant} · ${t.note}` : t.merchant) },
      Date: { date: { start: t.date } },
      Amount: { number: t.amount },
      Category: { select: { name: t.category ?? 'Other' } },
      Account: { select: { name: 'DBS' } },
      Month: text(t.date.slice(0, 7)),
    });
    done.add(String(t.id));
    n++;
    if (n % 20 === 0) await kvSet('ledger_pushed', JSON.stringify([...done]));
  }
  await kvSet('ledger_pushed', JSON.stringify([...done]));
  return n;
}

// Monthly budgets per category from "Spending Categories".
export async function budgets(): Promise<Record<string, number>> {
  const d = await dbs();
  if (!d.budgets) return {};
  const rows = await query(d.budgets);
  const out: Record<string, number> = {};
  for (const r of rows) {
    const b = r.properties['Monthly budget SGD']?.number as number | null;
    if (b != null) out[title(r)] = b;
  }
  return out;
}

export type { NotionNode };
