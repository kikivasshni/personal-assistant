import { Coach, ToolName } from '@/data/coaches';
import { createCommitment, openCommitments, setCommitmentStatus } from './commitments';
import { db } from './db';
import { searchClips } from './feed';
import { FunctionDeclaration } from './gemini';
import { addEvent, eventTime, listEvents } from './integrations/google';
import { addTodo, listTodos } from './integrations/microsoft';
import { addJournalEntry } from './integrations/notion';
import { addFact } from './memory';

// Function-calling tools the coaches can use. Each coach only gets the tools
// listed in its config.

const S = (description: string) => ({ type: 'STRING', description });
const N = (description: string) => ({ type: 'NUMBER', description });

export const DECLARATIONS: Record<ToolName, FunctionDeclaration> = {
  create_commitment: {
    name: 'create_commitment',
    description:
      'Lock in something kirthi has committed to doing at a specific time. Schedules escalating reminder notifications. Use whenever they agree to do something at a time.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: S('Short action, e.g. "30 min Terraform practice exam"'),
        due_iso: S('Local Singapore time, ISO 8601 without offset, e.g. 2026-11-03T20:00:00'),
      },
      required: ['title', 'due_iso'],
    },
  },
  complete_commitment: {
    name: 'complete_commitment',
    description: 'Mark a commitment done (or dropped) when kirthi reports it. Get ids from list_commitments.',
    parameters: {
      type: 'OBJECT',
      properties: { id: N('Commitment id'), status: { type: 'STRING', enum: ['done', 'dropped'] } },
      required: ['id'],
    },
  },
  list_commitments: {
    name: 'list_commitments',
    description: 'List all open commitments with ids and due times.',
  },
  remember_fact: {
    name: 'remember_fact',
    description: 'Save an important long-term fact about kirthi to shared memory, visible to every coach.',
    parameters: { type: 'OBJECT', properties: { fact: S('One sentence, third person') }, required: ['fact'] },
  },
  add_todo: {
    name: 'add_todo',
    description: "Add a task to kirthi's Microsoft To Do.",
    parameters: {
      type: 'OBJECT',
      properties: { title: S('Task title'), due_iso: S('Optional due date/time, ISO 8601 local') },
      required: ['title'],
    },
  },
  list_todos: { name: 'list_todos', description: "List kirthi's open Microsoft To Do tasks." },
  add_calendar_event: {
    name: 'add_calendar_event',
    description: "Block time in kirthi's Google Calendar (also shows in Notion Calendar).",
    parameters: {
      type: 'OBJECT',
      properties: {
        title: S('Event title'),
        start_iso: S('Start, ISO 8601 local Singapore time'),
        end_iso: S('End, ISO 8601 local Singapore time'),
        description: S('Optional notes'),
      },
      required: ['title', 'start_iso', 'end_iso'],
    },
  },
  list_calendar_events: {
    name: 'list_calendar_events',
    description: "List kirthi's calendar events for the next N days.",
    parameters: { type: 'OBJECT', properties: { days: N('Number of days from today, default 1') } },
  },
  notion_journal: {
    name: 'notion_journal',
    description: "Write a summary, plan or reflection into kirthi's Notion Journal database.",
    parameters: {
      type: 'OBJECT',
      properties: { title: S('Page title'), markdown: S('Body in simple Markdown') },
      required: ['title', 'markdown'],
    },
  },
  log_food: {
    name: 'log_food',
    description: 'Log a meal kirthi describes in words, with your macro estimate.',
    parameters: {
      type: 'OBJECT',
      properties: {
        description: S('What they ate'),
        kcal: N('Calories'),
        protein: N('Protein grams'),
        carbs: N('Carb grams'),
        fat: N('Fat grams'),
        fibre: N('Fibre grams'),
        note: S('One-line PCOS/insulin comment'),
      },
      required: ['description', 'kcal', 'protein', 'carbs', 'fat'],
    },
  },
  find_clips: {
    name: 'find_clips',
    description: "Find short YouTube clips on a topic and add them to kirthi's Goal Feed for this coach.",
    parameters: { type: 'OBJECT', properties: { query: S('Search query') }, required: ['query'] },
  },
};

export function declarationsFor(c: Coach): FunctionDeclaration[] {
  return c.tools.map((t) => DECLARATIONS[t]);
}

function parseLocal(iso: string): number {
  // Treat offset-less times as phone-local time.
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Couldn't read the time "${iso}".`);
  return t;
}

function localIso(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export type ToolResult = { result: Record<string, unknown>; note?: string };

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  c: Coach,
): Promise<ToolResult> {
  const s = (k: string) => String(args[k] ?? '');
  const n = (k: string) => (args[k] == null ? null : Number(args[k]));
  try {
    switch (name as ToolName) {
      case 'create_commitment': {
        const due = parseLocal(s('due_iso'));
        const cm = await createCommitment(c.id, s('title'), due);
        return {
          result: { ok: true, id: cm.id },
          note: `⏰ Locked in: ${cm.title}, ${new Date(due).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`,
        };
      }
      case 'complete_commitment': {
        const status = s('status') === 'dropped' ? 'dropped' : 'done';
        await setCommitmentStatus(Number(args.id), status);
        return { result: { ok: true }, note: status === 'done' ? '✓ Marked done' : 'Dropped' };
      }
      case 'list_commitments': {
        const list = await openCommitments();
        return {
          result: { commitments: list.map((x) => ({ id: x.id, title: x.title, due: localIso(x.due_at), coach: x.coach })) },
        };
      }
      case 'remember_fact': {
        await addFact(s('fact'), c.id);
        return { result: { ok: true }, note: '🧠 Saved to memory' };
      }
      case 'add_todo': {
        const t = await addTodo(s('title'), args.due_iso ? s('due_iso') : undefined);
        return { result: { ok: true, id: t.id }, note: `📝 Added to To Do: ${t.title}` };
      }
      case 'list_todos': {
        const items = await listTodos();
        return { result: { todos: items.map((t) => ({ title: t.title, due: t.dueDateTime?.dateTime ?? null })) } };
      }
      case 'add_calendar_event': {
        const e = await addEvent(s('title'), s('start_iso'), s('end_iso'), args.description ? s('description') : undefined);
        return { result: { ok: true, id: e.id }, note: `📅 Added to calendar: ${s('title')}` };
      }
      case 'list_calendar_events': {
        const events = await listEvents(n('days') ?? 1);
        return {
          result: { events: events.map((e) => ({ title: e.summary, start: e.start?.dateTime ?? e.start?.date, time: eventTime(e) })) },
        };
      }
      case 'notion_journal': {
        const url = await addJournalEntry(s('title'), s('markdown'));
        return { result: { ok: true, url }, note: '📓 Written to Notion' };
      }
      case 'log_food': {
        await (await db()).runAsync(
          'INSERT INTO food_log(description, kcal, protein, carbs, fat, fibre, note, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
          s('description'),
          n('kcal'),
          n('protein'),
          n('carbs'),
          n('fat'),
          n('fibre'),
          args.note ? s('note') : null,
          Date.now(),
        );
        return { result: { ok: true }, note: `🍽 Logged: ${s('description')}` };
      }
      case 'find_clips': {
        const added = await searchClips(s('query'), c.id);
        return {
          result: { ok: true, added },
          note: added ? `🎬 Added ${added} clips to your Goal Feed` : undefined,
        };
      }
    }
    return { result: { error: `Unknown tool ${name}` } };
  } catch (e) {
    // Give the model the error so it can tell kirthi what to fix.
    return { result: { error: e instanceof Error ? e.message : String(e) } };
  }
}
