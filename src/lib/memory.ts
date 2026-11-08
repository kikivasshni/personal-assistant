import { db, Fact, kvGet, kvSet, Message, startOfDay } from './db';
import { generateJson } from './gemini';
import { notifyChange } from './live';

// Shared memory: durable facts every coach can see, plus each coach's
// recent conversation. Retrieval is "recent + keyword match", which is plenty
// for a few thousand facts and costs no extra API calls.

export const DEFAULT_PROFILE = `Name: kirthi. Year 4 Software Engineering student at SMU, graduating May 2027. Internship ends 8 Jan 2027. Lives in Singapore (SGT).
Specialises in AWS cloud engineering; experienced developer.
Goals: AWS Solutions Architect Professional and Terraform Associate by 1 Dec 2026 (maybe AWS ML Engineer Associate). Full-time SWE role after graduating, while weighing a pilot career.
Health: manages PCOS without medication (insulin sensitivity focus). Ran a half marathon on 1 Nov 2026. Wants consistent strength training and fat loss.
Practices Law of Assumption (Neville Goddard: SATS, revision) and the Gateway tapes, working toward Focus 12.
Hobbies: photography around Singapore, Kathak weekly, self-taught electric guitar (Simply Guitar, GuitarTuna), music production, aviation engineering, F1.
Tools: Microsoft To Do for tasks, Google Calendar and Notion Calendar for scheduling, Notion as second brain.
Motivators: family's financial situation (money), models (fitness), F1 drivers especially Max Verstappen (performance).`;

export async function getProfile(): Promise<string> {
  return (await kvGet('profile')) ?? DEFAULT_PROFILE;
}

export async function setProfile(text: string) {
  await kvSet('profile', text);
  notifyChange('profile'); // syncs to the "Basics" row in Notion's profile
}

export async function addFact(text: string, coach?: string) {
  const t = text.trim();
  if (!t) return;
  const d = await db();
  const dup = await d.getFirstAsync<{ id: number }>('SELECT id FROM facts WHERE lower(text) = lower(?)', t);
  if (dup) return;
  await d.runAsync('INSERT INTO facts(text, coach, created_at) VALUES(?, ?, ?)', t, coach ?? null, Date.now());
}

export async function allFacts(): Promise<Fact[]> {
  return (await db()).getAllAsync<Fact>('SELECT * FROM facts ORDER BY created_at DESC');
}

export async function deleteFact(id: number) {
  await (await db()).runAsync('DELETE FROM facts WHERE id = ?', id);
}

const STOP = new Set('the a an and or but to of in on for with at is are was were be i me my you it this that do did have has what how when'.split(' '));

export async function relevantFacts(query: string, limit = 30): Promise<Fact[]> {
  const d = await db();
  const recent = await d.getAllAsync<Fact>('SELECT * FROM facts ORDER BY created_at DESC LIMIT 15');
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 8);
  let matched: Fact[] = [];
  if (words.length) {
    const where = words.map(() => 'lower(text) LIKE ?').join(' OR ');
    matched = await d.getAllAsync<Fact>(
      `SELECT * FROM facts WHERE ${where} ORDER BY created_at DESC LIMIT 20`,
      ...words.map((w) => `%${w}%`),
    );
  }
  const seen = new Set<number>();
  return [...matched, ...recent].filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true))).slice(0, limit);
}

// What happened across ALL coaches today, so each coach knows the others' news.
export async function crossCoachDigest(excludeCoach: string): Promise<string> {
  const d = await db();
  const rows = await d.getAllAsync<Message>(
    "SELECT * FROM messages WHERE coach != ? AND role = 'user' AND created_at >= ? ORDER BY created_at DESC LIMIT 12",
    excludeCoach,
    startOfDay(),
  );
  return rows
    .reverse()
    .map((m) => `- [${m.coach}] ${m.text.slice(0, 160)}`)
    .join('\n');
}

// After a conversation turn, pull out anything worth remembering long term.
export async function extractFacts(coach: string, userText: string, reply: string) {
  if (userText.trim().length < 25) return;
  try {
    const r = await generateJson<{ facts: string[] }>(
      `From this exchange, extract durable facts about kirthi worth remembering for weeks (goals, preferences, progress, constraints, events, numbers). Skip small talk and anything temporary. Each fact one short sentence, third person, include dates if mentioned (today is ${new Date().toDateString()}). Return {"facts": []} if none.

kirthi: ${userText}
Coach: ${reply}`,
      { temperature: 0.2 },
    );
    for (const f of (r.facts ?? []).slice(0, 5)) await addFact(f, coach);
  } catch {
    // memory extraction is best effort
  }
}
