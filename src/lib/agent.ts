import { coach as getCoach, Coach } from '@/data/coaches';
import { openCommitments } from './commitments';
import { db, Message, startOfDay } from './db';
import { GeminiContent, GeminiPart, generateRaw, textOf } from './gemini';
import { crossCoachDigest, extractFacts, getProfile, relevantFacts } from './memory';
import { declarationsFor, runTool } from './tools';

// One agent, nine personas. The coach decides the persona and which tools
// are allowed; every coach reads the same shared memory.

const RULES = `You are a coach inside "Kairos", kirthi's personal life OS on their phone. Several coaches share one memory; you can see notes from the others.
Style: warm, specific, human. Short paragraphs, under ~150 words unless asked for more. Light **bold** is fine, no headings. Ask at most one question at a time.
Proactive: when kirthi agrees to do something at a time, call create_commitment. Offer to block calendar time or add a To Do when useful. Save important new long-term facts with remember_fact.
If a tool returns an error about a missing connection, tell kirthi briefly what to set up in Settings and carry on.`;

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

async function coachExtras(c: Coach): Promise<string> {
  const d = await db();
  if (c.id === 'health') {
    const t = await d.getFirstAsync<{ kcal: number; protein: number; carbs: number; n: number }>(
      'SELECT SUM(kcal) kcal, SUM(protein) protein, SUM(carbs) carbs, COUNT(*) n FROM food_log WHERE created_at >= ?',
      startOfDay(),
    );
    if (t?.n) return `Food logged today: ${t.n} meals, ~${Math.round(t.kcal ?? 0)} kcal, ${Math.round(t.protein ?? 0)} g protein, ${Math.round(t.carbs ?? 0)} g carbs.`;
  }
  if (c.id === 'academics') {
    const notes = await d.getAllAsync<{ title: string; module: string | null }>(
      'SELECT title, module FROM notes ORDER BY created_at DESC LIMIT 12',
    );
    if (notes.length) return `kirthi's recent study notes: ${notes.map((n) => `${n.module ? n.module + ': ' : ''}${n.title}`).join('; ')}.`;
  }
  if (c.id === 'finance') {
    const rows = await d.getAllAsync<{ category: string; total: number }>(
      "SELECT COALESCE(category,'Uncategorised') category, ROUND(SUM(amount),2) total FROM transactions WHERE amount > 0 GROUP BY category ORDER BY total DESC LIMIT 8",
    );
    if (rows.length) return `Spending by category (all uploaded statements, SGD): ${rows.map((r) => `${r.category} ${r.total}`).join(', ')}.`;
  }
  if (c.id === 'wellbeing' || c.id === 'hq') {
    const m = await d.getAllAsync<{ mood: number; note: string | null; created_at: number }>(
      'SELECT mood, note, created_at FROM moods ORDER BY created_at DESC LIMIT 5',
    );
    if (m.length) return `Recent mood check-ins (1-5): ${m.map((x) => `${x.mood}${x.note ? ` "${x.note}"` : ''} on ${fmtTime(x.created_at)}`).join('; ')}.`;
  }
  return '';
}

export async function buildSystem(c: Coach, query: string): Promise<string> {
  const [profile, facts, digest, open, extras] = await Promise.all([
    getProfile(),
    relevantFacts(query),
    crossCoachDigest(c.id),
    openCommitments(),
    coachExtras(c),
  ]);
  return [
    RULES,
    `\n## Your role: ${c.name} (${c.role})\n${c.persona}`,
    `\n## Now\n${fmtTime(Date.now())} (Singapore time). Use this when converting "tonight", "tomorrow" etc. into ISO times.`,
    `\n## About kirthi\n${profile}`,
    facts.length ? `\n## Shared memory\n${facts.map((f) => `- ${f.text}`).join('\n')}` : '',
    digest ? `\n## Today kirthi told other coaches\n${digest}` : '',
    open.length
      ? `\n## Open commitments\n${open.slice(0, 12).map((x) => `- #${x.id} ${x.title} (due ${fmtTime(x.due_at)}, ${x.coach})`).join('\n')}`
      : '',
    extras ? `\n## Context\n${extras}` : '',
  ].join('\n');
}

export async function history(coachId: string, limit = 60): Promise<Message[]> {
  const rows = await (await db()).getAllAsync<Message>(
    'SELECT * FROM messages WHERE coach = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    coachId,
    limit,
  );
  return rows.reverse();
}

async function save(coachId: string, role: Message['role'], text: string) {
  await (await db()).runAsync(
    'INSERT INTO messages(coach, role, text, created_at) VALUES(?, ?, ?, ?)',
    coachId,
    role,
    text,
    Date.now(),
  );
}

export async function clearChat(coachId: string) {
  await (await db()).runAsync('DELETE FROM messages WHERE coach = ?', coachId);
}

export type Attachment = { mimeType: string; base64: string };

export async function sendMessage(coachId: string, text: string, attachment?: Attachment): Promise<void> {
  const c = getCoach(coachId);
  const past = (await history(c.id, 16)).filter((m) => m.role !== 'note');
  await save(c.id, 'user', attachment ? `[Photo] ${text}` : text);

  const contents: GeminiContent[] = past.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));
  const userParts: GeminiPart[] = [];
  if (attachment) userParts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.base64 } });
  userParts.push({ text });
  contents.push({ role: 'user', parts: userParts });

  const system = await buildSystem(c, text);
  const tools = declarationsFor(c);

  let reply = '';
  for (let round = 0; round < 5; round++) {
    const parts = await generateRaw(contents, { system, tools, heavy: !!attachment });
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      reply = textOf(parts);
      break;
    }
    contents.push({ role: 'model', parts });
    const responses: GeminiPart[] = [];
    for (const p of calls) {
      const call = p.functionCall!;
      const out = await runTool(call.name, call.args ?? {}, c);
      if (out.note) await save(c.id, 'note', out.note);
      responses.push({ functionResponse: { name: call.name, response: out.result } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  if (!reply) reply = "Done. Anything else?";
  await save(c.id, 'model', reply);
  // Memory extraction runs in the background so the reply shows immediately.
  extractFacts(c.id, text, reply).catch(() => {});
}
