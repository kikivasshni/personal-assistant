import { commitmentsForDay, recentStats } from './commitments';
import { db, dayKey } from './db';
import { generateJson } from './gemini';
import { eventTime, listEvents } from './integrations/google';
import { listTodos } from './integrations/microsoft';
import { isConnected, GOOGLE, MICROSOFT } from './integrations/oauth';
import { getProfile, relevantFacts } from './memory';

export type Briefing = {
  greeting: string;
  affirmation: string;
  focus: string[];
  schedule: string;
  nudge: string;
};

export async function cachedBriefing(): Promise<Briefing | null> {
  const r = await (await db()).getFirstAsync<{ text: string }>('SELECT text FROM briefings WHERE day = ?', dayKey());
  if (!r) return null;
  try {
    return JSON.parse(r.text) as Briefing;
  } catch {
    return null;
  }
}

export async function makeBriefing(force = false): Promise<Briefing> {
  if (!force) {
    const c = await cachedBriefing();
    if (c) return c;
  }
  const [profile, facts, today, stats] = await Promise.all([
    getProfile(),
    relevantFacts('goals progress plan', 20),
    commitmentsForDay(),
    recentStats(7),
  ]);
  let events = 'Calendar not connected.';
  if (await isConnected(GOOGLE)) {
    try {
      const ev = await listEvents(1);
      events = ev.length ? ev.map((e) => `${eventTime(e)} ${e.summary ?? ''}`).join('; ') : 'No events today.';
    } catch {
      events = 'Calendar unavailable.';
    }
  }
  let todos = 'To Do not connected.';
  if (await isConnected(MICROSOFT)) {
    try {
      const t = await listTodos(15);
      todos = t.length ? t.map((x) => x.title).join('; ') : 'No open tasks.';
    } catch {
      todos = 'To Do unavailable.';
    }
  }

  const b = await generateJson<Briefing>(
    `You are The Oracle, kirthi's chief of staff. Write today's morning briefing.
Today: ${new Date().toDateString()}.
About kirthi: ${profile}
Memory: ${facts.map((f) => f.text).join(' | ')}
Calendar: ${events}
To Do: ${todos}
Commitments today: ${today.map((c) => `${c.title} (${new Date(c.due_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, ${c.status})`).join('; ') || 'none yet'}
Last 7 days: ${stats.done} done, ${stats.missed} missed.

Return JSON:
{"greeting": "one warm line using their name",
 "affirmation": "one first-person present-tense Law of Assumption affirmation tied to a current goal",
 "focus": ["3 specific priorities for today, each under 70 characters"],
 "schedule": "one or two sentences on how to shape the day around the calendar",
 "nudge": "one line of honest accountability based on the last 7 days"}`,
    { heavy: true, temperature: 0.8 },
  );
  await (await db()).runAsync(
    'INSERT INTO briefings(day, kind, text, created_at) VALUES(?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET text = excluded.text, created_at = excluded.created_at',
    dayKey(),
    'morning',
    JSON.stringify(b),
    Date.now(),
  );
  return b;
}
