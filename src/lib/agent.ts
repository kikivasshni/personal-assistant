import { resolve, Resolved } from '@/data/spaces';
import { openCommitments } from './commitments';
import { db, kvGet, Message, startOfDay } from './db';
import { listDesires, todaysAffirmations } from './desires';
import { financeContext } from './finance';
import { habitsContext } from './habits';
import { cleanReply, GeminiContent, GeminiPart, generateRaw, textOf } from './gemini';
import { cycleInfo, recentSymptoms, recentWorkouts, snapshot } from './health';
import { listSongs, practiceStats } from './hobbies';
import { outline, workspaceMap } from './integrations/notion';
import { hasSecondBrain, NOTE_STYLE, notebookContext, notebooks } from './integrations/secondBrain';
import { crossCoachDigest, extractFacts, getProfile, relevantFacts } from './memory';
import { declarationsFor, notionHome, runTool } from './tools';

// One agent, many cards. A card (thread) decides the persona, focus, tools
// and live context; every card reads the same shared memory.

const RULES = `You are a coach inside "Kairos", kirthi's personal life OS on their phone. Several coaches share one memory; you can see notes from the others.
Style: warm, specific, human. Short paragraphs, under ~150 words unless asked for more or teaching something that needs it. Light **bold** is fine; use ## headings only for long explanations. Ask at most one question at a time.
Proactive: when kirthi agrees to do something at a time, call create_commitment. Add tasks for things to do today or this week with add_task. Save important long-term facts with remember_fact.
If a tool returns an error about a missing connection, tell kirthi in one line what to set up under You, and carry on.`;

const NOTION_RULES = `Notion is kirthi's second brain. When they tell you something worth keeping (something they learnt, a plan, progress, a new interest), update Notion without being asked:
1. Find where it belongs in the outline below (or this card's Notion home). If a page for the topic exists, append to it.
2. If the topic is new, read a sibling page with notion_read first and mirror its structure (headings, sections, tables), then create the page under the parent that matches their existing organisation.
3. Say in one short line where you put it.`;

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const ago = (ms: number) => {
  const d = Math.floor((startOfDay() - startOfDay(new Date(ms))) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

async function cardContext(t: Resolved): Promise<string> {
  const d = await db();
  const out: string[] = [];
  switch (t.panel) {
    case 'food': {
      const meals = await d.getAllAsync<{ id: number; description: string; kcal: number; protein: number; carbs: number; created_at: number }>(
        'SELECT id, description, kcal, protein, carbs, created_at FROM food_log WHERE created_at >= ? ORDER BY created_at',
        startOfDay() - 6 * 86_400_000,
      );
      const today = meals.filter((m) => m.created_at >= startOfDay());
      out.push(
        today.length
          ? `Eaten today: ${today.map((m) => `[meal ${m.id}] ${m.description} (${Math.round(m.kcal ?? 0)} kcal, ${Math.round(m.protein ?? 0)} g protein, ${Math.round(m.carbs ?? 0)} g carbs)`).join('; ')}.`
          : 'Nothing logged today yet.',
      );
      if (meals.length > today.length)
        out.push(`Earlier this week: ${meals.filter((m) => m.created_at < startOfDay()).map((m) => `${ago(m.created_at)}: ${m.description}`).join('; ')}.`);
      break;
    }
    case 'move': {
      const snap = await snapshot().catch(() => null);
      if (snap)
        out.push(
          `Samsung Health: steps last 7 days ${snap.week.map((w) => w.steps).join(', ')} (today ${snap.today.steps}). Sleep last night ${snap.sleepHours ?? '?'} h. Weight ${snap.weightKg ?? '?'} kg.`,
        );
      else out.push('Samsung Health is not connected yet (You → Samsung Health).');
      const w = await recentWorkouts(14);
      out.push(
        w.length
          ? `Workouts in the last 14 days: ${w.map((x) => `${ago(x.created_at)}: ${x.title}${x.minutes ? ` ${x.minutes} min` : ''}${x.details ? ` (${x.details})` : ''}`).join('; ')}.`
          : 'No workouts logged in the last 14 days.',
      );
      break;
    }
    case 'cycle': {
      const c = await cycleInfo();
      out.push(
        c.starts.length
          ? `Cycle: day ${c.cycleDay}, ${c.phase} phase. Recent period starts: ${c.starts.slice(0, 5).join(', ')}. Average cycle ${c.avgLength ?? 'unknown'} days. Next expected ${c.nextStart}${c.lateBy ? ` (${c.lateBy} days late)` : ''}.`
          : 'No period data yet. Ask when their last period started and log it with log_cycle.',
      );
      const sym = await recentSymptoms();
      if (sym.length) out.push(`Recent symptoms: ${sym.map((s) => `${s.day}: ${s.note}`).join('; ')}.`);
      break;
    }
    case 'study': {
      const exam = await kvGet(`exam:${t.id}`);
      if (exam) out.push(`Exam date: ${exam} (${Math.ceil((Date.parse(exam) - Date.now()) / 86_400_000)} days away).`);
      const p = await practiceStats(t.id);
      out.push(
        p.lastAt
          ? `Study log: last session ${ago(p.lastAt)}, ${p.week} min in the last 7 days, streak ${p.streak} days. Recent: ${p.recent.map((r) => r.note).filter(Boolean).join('; ')}.`
          : 'No study sessions logged for this topic yet.',
      );
      if (t.id === 'study.school') {
        const notes = await d.getAllAsync<{ title: string; module: string | null }>('SELECT title, module FROM notes ORDER BY created_at DESC LIMIT 12');
        if (notes.length) out.push(`Saved lecture notes: ${notes.map((n) => `${n.module ? n.module + ': ' : ''}${n.title}`).join('; ')}.`);
      }
      break;
    }
    case 'guitar':
    case 'practice': {
      const p = await practiceStats(t.id);
      out.push(
        p.lastAt
          ? `Practice: last ${ago(p.lastAt)} (${p.daysSince} days), ${p.week} min this week, streak ${p.streak}. Recent: ${p.recent.map((r) => r.note).filter(Boolean).join('; ')}.`
          : 'No practice logged yet for this hobby.',
      );
      if (t.panel === 'guitar') {
        const songs = await listSongs();
        if (songs.length) out.push(`Songs: ${songs.map((s) => `${s.title}${s.artist ? ` (${s.artist})` : ''} [${s.status}]${s.notes ? `: ${s.notes}` : ''}`).join('; ')}.`);
      }
      break;
    }
    case 'desires': {
      const list = await listDesires();
      out.push(
        list.length
          ? `Desires:\n${list.map((x) => `- #${x.id} ${x.title} [${x.status}${x.manifested_at ? ` ${new Date(x.manifested_at).toDateString()}` : `, assuming since ${new Date(x.created_at).toDateString()}`}]${x.scene ? ` scene: ${x.scene}` : ''}`).join('\n')}`
          : 'No desires saved yet. Help them name their first one and save it.',
      );
      const aff = await todaysAffirmations();
      if (aff) out.push(`Today's affirmations: morning "${aff.morning}", night "${aff.night}".`);
      break;
    }
    case 'advisor':
      out.push(await financeContext());
      break;
  }
  if (t.space === 'hq' || t.space === 'wellbeing') {
    const m = await d.getAllAsync<{ mood: number; note: string | null; created_at: number }>(
      'SELECT mood, note, created_at FROM moods ORDER BY created_at DESC LIMIT 7',
    );
    if (m.length) out.push(`Recent moods (1-5): ${m.map((x) => `${x.mood}${x.note ? ` "${x.note}"` : ''} ${ago(x.created_at)}`).join('; ')}.`);
  }
  return out.join('\n');
}

async function notionContext(t: Resolved): Promise<string> {
  if (!t.tools.includes('notion_write')) return '';
  const nodes = await workspaceMap().catch(() => []);
  if (!nodes.length) return '';
  const home = await notionHome(t.id);
  if (await hasSecondBrain().catch(() => false)) {
    const books = await notebooks().catch(() => []);
    return [
      `Notion is kirthi's PARA second brain. Study and hobby notes live as rows in the "notes" database, each linked to a notebook (one per subject). When kirthi learns something worth keeping, save it with save_note without being asked: append to the matching existing note, or create a new note in the right notebook. Say in one short line where you put it. Use notion_read on an existing note when you need its exact content.`,
      NOTE_STYLE,
      t.notebook ? await notebookContext(t.notebook).catch(() => '') : '',
      `Notebooks: ${books.map((b) => b.name).join(', ')}.`,
      'Tasks go to the tasks database automatically via add_task; food and workouts are mirrored to the Food & Health Log and Training Log automatically.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    NOTION_RULES,
    home ? `This card's Notion home: ${home.split('|')[1]} (${home.split('|')[0].slice(0, 8)}).` : '',
    `Workspace outline (title (id)):\n${outline(nodes, 140)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function buildSystem(t: Resolved, query: string): Promise<string> {
  const [profile, facts, digest, open, extras, notion, habits] = await Promise.all([
    getProfile(),
    relevantFacts(query),
    crossCoachDigest(t.id),
    openCommitments(),
    cardContext(t).catch(() => ''),
    notionContext(t),
    habitsContext().catch(() => ''),
  ]);
  return [
    RULES,
    `\n## Your role: ${t.spaceObj.name}${t.spaceObj.threads.length > 1 || t.custom ? ` · ${t.title}` : ''}\n${t.spaceObj.persona}${t.focus ? `\n${t.focus}` : ''}`,
    `\n## Now\n${fmtTime(Date.now())} (Singapore time). Use this when converting "tonight", "tomorrow" etc. into ISO times.`,
    `\n## About kirthi\n${profile}`,
    facts.length ? `\n## Shared memory\n${facts.map((f) => `- ${f.text}`).join('\n')}` : '',
    digest ? `\n## Today kirthi told other coaches\n${digest}` : '',
    open.length
      ? `\n## Open commitments\n${open.slice(0, 12).map((x) => `- #${x.id} ${x.title} (due ${fmtTime(x.due_at)})`).join('\n')}`
      : '',
    habits ? `\n## Habits\n${habits}` : '',
    extras ? `\n## Live context for this card\n${extras}` : '',
    notion ? `\n## Notion\n${notion}` : '',
  ].join('\n');
}

export async function history(threadId: string, limit = 60): Promise<Message[]> {
  const rows = await (await db()).getAllAsync<Message>(
    'SELECT * FROM messages WHERE coach = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    threadId,
    limit,
  );
  return rows.reverse();
}

async function save(threadId: string, role: Message['role'], text: string): Promise<number> {
  const r = await (await db()).runAsync('INSERT INTO messages(coach, role, text, created_at) VALUES(?, ?, ?, ?)', threadId, role, text, Date.now());
  return r.lastInsertRowId;
}

export async function clearChat(threadId: string) {
  await (await db()).runAsync('DELETE FROM messages WHERE coach = ?', threadId);
}

export type Attachment = { mimeType: string; base64: string };

const TOOL_STATUS: Record<string, string> = {
  notion_search: 'Looking through your Notion',
  notion_read: 'Reading your Notion',
  notion_write: 'Writing to Notion',
  health_data: 'Checking Samsung Health',
  add_task: 'Adding a task',
  list_tasks: 'Checking your tasks',
  add_calendar_event: 'Blocking time',
  list_calendar_events: 'Checking your calendar',
  create_commitment: 'Locking it in',
  find_clips: 'Finding clips',
  log_habit: 'Ticking your habit tracker',
};

export type SendCallbacks = {
  onText?: (text: string) => void; // streamed reply so far
  onStatus?: (status: string | null) => void; // e.g. "Writing to Notion"
  signal?: AbortSignal;
};

export async function sendMessage(threadId: string, text: string, attachment?: Attachment, cb: SendCallbacks = {}): Promise<void> {
  const t = resolve(threadId);
  const past = (await history(t.id, 16)).filter((m) => m.role !== 'note');
  const userMsgId = await save(t.id, 'user', attachment ? `[Photo] ${text}` : text);
  try {
    await converse(t, text, past, userMsgId, attachment, cb);
  } catch (e) {
    // Drop the unanswered message so Retry doesn't duplicate it.
    await (await db()).runAsync('DELETE FROM messages WHERE id = ?', userMsgId);
    throw e;
  }
}

async function converse(t: Resolved, text: string, past: Message[], _userMsgId: number, attachment: Attachment | undefined, cb: SendCallbacks) {

  const contents: GeminiContent[] = past.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
  const userParts: GeminiPart[] = [];
  if (attachment) userParts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.base64 } });
  userParts.push({ text });
  contents.push({ role: 'user', parts: userParts });

  const system = await buildSystem(t, text);
  const tools = declarationsFor(t);

  let reply = '';
  for (let round = 0; round < 6; round++) {
    const parts = await generateRaw(contents, {
      system,
      tools,
      heavy: !!attachment,
      thinking: 'low',
      signal: cb.signal,
      onText: cb.onText,
    });
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      reply = cleanReply(textOf(parts));
      break;
    }
    contents.push({ role: 'model', parts });
    const responses: GeminiPart[] = [];
    for (const p of calls) {
      const call = p.functionCall!;
      cb.onStatus?.(TOOL_STATUS[call.name] ?? 'Working on it');
      const out = await runTool(call.name, call.args ?? {}, t);
      if (out.note) await save(t.id, 'note', out.note);
      responses.push({ functionResponse: { name: call.name, response: out.result } });
    }
    cb.onStatus?.(null);
    cb.onText?.('');
    contents.push({ role: 'user', parts: responses });
  }

  if (!reply) reply = 'Done. Anything else?';
  await save(t.id, 'model', reply);
  // Memory extraction runs in the background so the reply shows immediately.
  extractFacts(t.id, text, reply).catch(() => {});
}
