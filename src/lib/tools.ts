import { Resolved, ToolName } from '@/data/spaces';
import { createCommitment, openCommitments, setCommitmentStatus } from './commitments';
import { db, dayKey, kvGet, kvSet } from './db';
import { saveDesire } from './desires';
import { searchClips } from './feed';
import { FunctionDeclaration } from './gemini';
import { loadHabits, matchHabit, setHabit, streak } from './habits';
import { cycleInfo, logPeriodDay, logSymptom, logWorkout, snapshot } from './health';
import { logPractice, saveSong } from './hobbies';
import { addEvent, eventTime, listEvents } from './integrations/google';
import { appendToPage, createPage, readPage, search } from './integrations/notion';
import { saveNote } from './integrations/secondBrain';
import { addFact } from './memory';
import { addTask, listTasks, setTaskDone } from './tasks';

// Function-calling tools the coaches can use. Each space lists the tools it
// gets; cards can add extras (e.g. save_song on the guitar card).

const S = (description: string) => ({ type: 'STRING', description });
const N = (description: string) => ({ type: 'NUMBER', description });
const E = (description: string, values: string[]) => ({ type: 'STRING', description, enum: values });

export const DECLARATIONS: Record<ToolName, FunctionDeclaration> = {
  create_commitment: {
    name: 'create_commitment',
    description:
      'Lock in something kirthi has committed to doing at a specific time. Schedules escalating reminder notifications (nags). Use whenever they agree to do something at a time.',
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
      properties: { id: N('Commitment id'), status: E('done or dropped', ['done', 'dropped']) },
      required: ['id'],
    },
  },
  list_commitments: { name: 'list_commitments', description: 'List all open commitments with ids and due times.' },
  remember_fact: {
    name: 'remember_fact',
    description: 'Save an important long-term fact about kirthi to shared memory, visible to every coach.',
    parameters: { type: 'OBJECT', properties: { fact: S('One sentence, third person') }, required: ['fact'] },
  },
  add_task: {
    name: 'add_task',
    description:
      "Add a to-do to kirthi's task list (Microsoft To Do, which syncs to Samsung Reminder and their Notion tasks). Use a due day for today/this week items.",
    parameters: {
      type: 'OBJECT',
      properties: {
        title: S('Task title'),
        due_day: S('Optional due date YYYY-MM-DD'),
        remind_at_iso: S('Optional reminder time, local ISO 8601, e.g. 2026-11-09T09:00:00'),
      },
      required: ['title'],
    },
  },
  list_tasks: { name: 'list_tasks', description: "List kirthi's open tasks with ids and due days." },
  complete_task: {
    name: 'complete_task',
    description: 'Tick off a task. Get the id from list_tasks.',
    parameters: { type: 'OBJECT', properties: { id: S('Task id') }, required: ['id'] },
  },
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
  notion_search: {
    name: 'notion_search',
    description: "Search kirthi's Notion workspace by title. Returns page/database ids. The workspace outline in your context is usually enough to pick a page.",
    parameters: { type: 'OBJECT', properties: { query: S('Words in the page title') }, required: ['query'] },
  },
  notion_read: {
    name: 'notion_read',
    description:
      'Read a Notion page (as Markdown) or list a database. Read an existing sibling page before writing a new one so you match how kirthi structures notes.',
    parameters: { type: 'OBJECT', properties: { id: S('Page id (the 8-char id from the outline is fine) or URL') }, required: ['id'] },
  },
  notion_write: {
    name: 'notion_write',
    description:
      "Write to kirthi's Notion. mode=append adds to the end of an existing page (use for adding to existing notes). mode=create makes a new page under parent_id (use when the topic is new; pick the parent that fits their existing structure). Supports Markdown headings, bullets, to-dos, tables, code blocks (```tab for guitar tabs).",
    parameters: {
      type: 'OBJECT',
      properties: {
        mode: E('append or create', ['append', 'create']),
        id: S('For append: the page id. For create: the parent page or database id.'),
        title: S('For create: the new page title'),
        markdown: S('Content'),
      },
      required: ['mode', 'id', 'markdown'],
    },
  },
  save_note: {
    name: 'save_note',
    description:
      "Save study or hobby notes into kirthi's Notion second brain: a row in the `notes` database linked to a notebook (one notebook per subject, e.g. \"AWS SAP-C03\", \"Electric guitar\"). If a note with the same title exists in that notebook it is appended to; otherwise a new note is created. Creates the notebook if it doesn't exist. Use this (not notion_write) for anything learnt.",
    parameters: {
      type: 'OBJECT',
      properties: {
        notebook: S("Notebook name. Defaults to this card's notebook."),
        title: S('Note title, a topic like their existing ones, e.g. "Cost Control & Optimization"'),
        markdown: S("Content in kirthi's note style"),
      },
      required: ['title', 'markdown'],
    },
  },
  log_food: {
    name: 'log_food',
    description:
      "Log a meal kirthi describes in words, with your macro estimate. If they're correcting or adding to a meal already logged today (e.g. 'you forgot the fries'), pass that meal's id as replaces_id with the full corrected meal, so it isn't counted twice.",
    parameters: {
      type: 'OBJECT',
      properties: {
        replaces_id: N("Id of today's logged meal this corrects (shown as [meal N] in context). Leave out for a new meal."),
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
  log_habit: {
    name: 'log_habit',
    description:
      "Tick (or untick) a habit in kirthi's Notion habit tracker when they say they did it, e.g. drank their water, went for a run, skipped sugar. The habit names are listed in your context under 'Habits today'.",
    parameters: {
      type: 'OBJECT',
      properties: {
        habit: S('The habit, as named in the tracker (close wording is matched)'),
        done: { type: 'BOOLEAN', description: 'true to tick (default), false to untick' },
        day: S('Optional YYYY-MM-DD if not today'),
      },
      required: ['habit'],
    },
  },
  log_workout: {
    name: 'log_workout',
    description: 'Log exercise kirthi reports (strength session, run, class, walk).',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: S('e.g. "Lower body strength" or "5 km run"'),
        minutes: N('Duration in minutes'),
        details: S('Exercises, sets × reps × weight, distance, pace, how it felt'),
        distance_km: N('Distance in km, for runs and walks'),
        day: S('Optional YYYY-MM-DD if not today'),
      },
      required: ['title'],
    },
  },
  log_cycle: {
    name: 'log_cycle',
    description: 'Log a period day (start or ongoing) or a PCOS symptom kirthi mentions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        kind: E('period or symptom', ['period', 'symptom']),
        day: S('YYYY-MM-DD, default today'),
        note: S('For symptoms: what and how bad'),
      },
      required: ['kind'],
    },
  },
  health_data: {
    name: 'health_data',
    description: 'Read Samsung Health data via Health Connect: steps and active calories for 7 days, last sleep, latest weight, workouts in the last 14 days, cycle summary.',
  },
  log_practice: {
    name: 'log_practice',
    description: 'Log a practice or study session for this card (counts toward streaks).',
    parameters: {
      type: 'OBJECT',
      properties: { minutes: N('Minutes practised'), note: S('What they worked on or learnt') },
    },
  },
  save_song: {
    name: 'save_song',
    description: "Add or update a song in kirthi's guitar song list.",
    parameters: {
      type: 'OBJECT',
      properties: {
        title: S('Song title'),
        artist: S('Artist'),
        status: E('wishlist, learning or learned', ['wishlist', 'learning', 'learned']),
        notes: S('Progress notes: which sections they can play, what to fix next'),
        tabs: S('Full tabs for the song as ```tab blocks, if you wrote them out'),
      },
      required: ['title'],
    },
  },
  save_desire: {
    name: 'save_desire',
    description: "Add or update one of kirthi's desires. To mark one manifested, set status=manifested and add the story.",
    parameters: {
      type: 'OBJECT',
      properties: {
        id: N('Existing desire id, if updating'),
        title: S('The desire, stated as the end result, e.g. "Offer from a top cloud team"'),
        detail: S('Specifics'),
        scene: S('The SATS scene that implies it is done'),
        status: E('pending, manifested or released', ['pending', 'manifested', 'released']),
        story: S('How it manifested'),
      },
    },
  },
  find_clips: {
    name: 'find_clips',
    description: "Find short YouTube clips on a topic and add them to kirthi's Goal Feed.",
    parameters: { type: 'OBJECT', properties: { query: S('Search query') }, required: ['query'] },
  },
};

export function declarationsFor(t: Resolved): FunctionDeclaration[] {
  return t.tools.map((n) => DECLARATIONS[n]);
}

function parseLocal(iso: string): number {
  // Offset-less ISO strings are read as phone-local time.
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Couldn't read the time "${iso}".`);
  return t;
}

function localIso(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

// The Notion page a card writes to most, so the coach goes back to it.
export async function notionHome(threadId: string): Promise<string | null> {
  return kvGet(`notion_home:${threadId}`);
}

export type ToolResult = { result: Record<string, unknown>; note?: string };

export async function runTool(name: string, args: Record<string, unknown>, t: Resolved): Promise<ToolResult> {
  const s = (k: string) => String(args[k] ?? '');
  const opt = (k: string) => (args[k] == null || args[k] === '' ? null : String(args[k]));
  const n = (k: string) => (args[k] == null || args[k] === '' ? null : Number(args[k]));
  try {
    switch (name as ToolName) {
      case 'create_commitment': {
        const due = parseLocal(s('due_iso'));
        const cm = await createCommitment(t.id, s('title'), due);
        return {
          result: { ok: true, id: cm.id },
          note: `Locked in: ${cm.title}, ${new Date(due).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`,
        };
      }
      case 'complete_commitment': {
        const status = s('status') === 'dropped' ? 'dropped' : 'done';
        await setCommitmentStatus(Number(args.id), status);
        return { result: { ok: true }, note: status === 'done' ? 'Marked done' : 'Dropped' };
      }
      case 'list_commitments': {
        const list = await openCommitments();
        return { result: { commitments: list.map((x) => ({ id: x.id, title: x.title, due: localIso(x.due_at), card: x.coach })) } };
      }
      case 'remember_fact': {
        await addFact(s('fact'), t.id);
        return { result: { ok: true }, note: 'Saved to memory' };
      }
      case 'add_task': {
        const task = await addTask(s('title'), opt('due_day'), opt('remind_at_iso'));
        return { result: { ok: true, id: task.id }, note: `Added to your tasks: ${task.title}` };
      }
      case 'list_tasks': {
        const tasks = (await listTasks()).filter((x) => !x.done);
        return { result: { today: dayKey(), tasks: tasks.map((x) => ({ id: x.id, title: x.title, due: x.due })) } };
      }
      case 'complete_task': {
        const task = (await listTasks()).find((x) => x.id === s('id'));
        if (!task) return { result: { error: 'No open task with that id. Call list_tasks.' } };
        await setTaskDone(task, true);
        return { result: { ok: true }, note: `Ticked off: ${task.title}` };
      }
      case 'add_calendar_event': {
        const e = await addEvent(s('title'), s('start_iso'), s('end_iso'), opt('description') ?? undefined);
        return { result: { ok: true, id: e.id }, note: `Added to calendar: ${s('title')}` };
      }
      case 'list_calendar_events': {
        const events = await listEvents(n('days') ?? 1);
        return {
          result: { events: events.map((e) => ({ title: e.summary, start: e.start?.dateTime ?? e.start?.date, time: eventTime(e) })) },
        };
      }
      case 'notion_search': {
        const hits = await search(s('query'));
        return { result: { results: hits.map((h) => ({ id: h.id, title: h.title, kind: h.kind })) } };
      }
      case 'notion_read': {
        const p = await readPage(s('id'));
        return { result: { title: p.title, url: p.url, markdown: p.markdown.slice(0, 12_000) } };
      }
      case 'notion_write': {
        if (s('mode') === 'create') {
          const node = await createPage(s('id'), s('title') || 'Notes', s('markdown'));
          await kvSet(`notion_home:${t.id}`, `${node.id}|${node.title}`);
          return { result: { ok: true, id: node.id, url: node.url }, note: `New Notion page: ${node.title}` };
        }
        const url = await appendToPage(s('id'), s('markdown'));
        const page = await readPage(s('id'), 1).catch(() => null);
        if (page) await kvSet(`notion_home:${t.id}`, `${s('id')}|${page.title}`);
        return { result: { ok: true, url }, note: `Updated Notion${page ? `: ${page.title}` : ''}` };
      }
      case 'save_note': {
        const book = opt('notebook') ?? t.notebook ?? t.title;
        const r = await saveNote({ notebook: book, title: s('title'), markdown: s('markdown'), area: t.area });
        return { result: { ok: true, url: r.url, created: r.created }, note: `${r.created ? 'New note' : 'Added to'} “${s('title')}” in ${r.notebook}` };
      }
      case 'log_food': {
        const d = await db();
        const replaces = n('replaces_id');
        if (replaces != null) {
          // A correction: update the meal in place (the sync updates Notion too).
          const r = await d.runAsync(
            'UPDATE food_log SET description = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, fibre = ?, note = ? WHERE id = ?',
            s('description'),
            n('kcal'),
            n('protein'),
            n('carbs'),
            n('fat'),
            n('fibre'),
            opt('note'),
            replaces,
          );
          if (r.changes) return { result: { ok: true, updated: replaces }, note: `Updated: ${s('description')}` };
        }
        await d.runAsync(
          'INSERT INTO food_log(description, kcal, protein, carbs, fat, fibre, note, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
          s('description'),
          n('kcal'),
          n('protein'),
          n('carbs'),
          n('fat'),
          n('fibre'),
          opt('note'),
          Date.now(),
        );
        return { result: { ok: true }, note: `Logged: ${s('description')}` };
      }
      case 'log_workout': {
        const day = opt('day');
        // The sync copies it to Notion's training log.
        await logWorkout(s('title'), n('minutes'), opt('details'), day ? parseLocal(`${day}T12:00:00`) : Date.now());
        return { result: { ok: true }, note: `Workout logged: ${s('title')}` };
      }
      case 'log_habit': {
        const state = await loadHabits(5 * 60_000);
        if (!state) return { result: { ok: false, error: 'No habit tracker database is shared with Kairos in Notion.' } };
        const habit = matchHabit(state.habits, s('habit'));
        if (!habit) return { result: { ok: false, error: `No habit like "${s('habit')}". Habits: ${state.habits.join(', ')}.` } };
        const done = args.done !== false;
        const day = opt('day') ?? dayKey();
        const after = await setHabit(habit, done, day);
        return {
          result: { ok: true, habit, done, streak: streak(after, habit) },
          note: done ? `Habit ticked: ${habit}` : `Habit unticked: ${habit}`,
        };
      }
      case 'log_cycle': {
        const day = opt('day') ?? dayKey();
        if (s('kind') === 'period') {
          await logPeriodDay(day);
          return { result: { ok: true, cycle: await cycleInfo() }, note: `Period logged for ${day}` };
        }
        await logSymptom(s('note'), day);
        return { result: { ok: true }, note: 'Symptom logged' };
      }
      case 'health_data': {
        const snap = await snapshot();
        const cycle = await cycleInfo();
        return {
          result: {
            samsung_health: snap ?? 'Not connected. kirthi can connect Samsung Health in You → Samsung Health.',
            cycle: { cycleDay: cycle.cycleDay, phase: cycle.phase, avgLength: cycle.avgLength, nextStart: cycle.nextStart, recentStarts: cycle.starts.slice(0, 4) },
          },
        };
      }
      case 'log_practice': {
        await logPractice(t.id, n('minutes'), opt('note'));
        return { result: { ok: true }, note: `Practice logged${n('minutes') ? `: ${n('minutes')} min` : ''}` };
      }
      case 'save_song': {
        const song = await saveSong({
          title: s('title'),
          artist: opt('artist'),
          status: (opt('status') as 'wishlist' | 'learning' | 'learned' | null) ?? undefined,
          notes: opt('notes'),
          tabs: opt('tabs'),
        });
        return { result: { ok: true, id: song.id }, note: `${song.title}: ${song.status}` };
      }
      case 'save_desire': {
        const d = await saveDesire({
          id: n('id'),
          title: opt('title') ?? undefined,
          detail: opt('detail') ?? undefined,
          scene: opt('scene') ?? undefined,
          status: (opt('status') as 'pending' | 'manifested' | 'released' | null) ?? undefined,
          story: opt('story') ?? undefined,
        });
        return {
          result: { ok: true, id: d.id },
          note: d.status === 'manifested' ? `Manifested: ${d.title}` : `Desire saved: ${d.title}`,
        };
      }
      case 'find_clips': {
        const added = await searchClips(s('query'), t.space);
        return { result: { ok: true, added }, note: added ? `Added ${added} clips to your Goal Feed` : undefined };
      }
    }
    return { result: { error: `Unknown tool ${name}` } };
  } catch (e) {
    // Give the model the error so it can tell kirthi what to fix.
    return { result: { error: e instanceof Error ? e.message : String(e) } };
  }
}
