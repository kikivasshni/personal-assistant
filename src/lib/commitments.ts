import { coach } from '@/data/coaches';
import { Commitment, db, startOfDay } from './db';
import { generateJson } from './gemini';
import { cancelIds, NagLines, scheduleChain } from './nags';

// Ask Gemini for three escalating nag lines in the coach's voice.
// Falls back to templates if Gemini is unreachable, so a nag is never lost.
async function nagLines(coachId: string, title: string, when: Date): Promise<NagLines> {
  const fallback: NagLines = [
    `It's time: ${title}.`,
    `Still not done: ${title}. Start with just 5 minutes.`,
    `You said you'd ${title}. Future you is watching. Do it now.`,
  ];
  try {
    const c = coach(coachId);
    const r = await generateJson<{ lines: string[] }>(
      `Write 3 push-notification lines (max 110 characters each) nudging kirthi to do: "${title}" at ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
Line 1: friendly reminder in the voice of ${c.name} (${c.role}).
Line 2: firmer, 30 minutes later, still that coach.
Line 3: 75 minutes later, from the Drive coach: high-performance, Max Verstappen energy, firm not cruel.
Return JSON: {"lines": ["...", "...", "..."]}`,
      { temperature: 0.9 },
    );
    if (Array.isArray(r.lines) && r.lines.length >= 3) return [r.lines[0], r.lines[1], r.lines[2]];
  } catch {
    // fall through to templates
  }
  return fallback;
}

export async function createCommitment(coachId: string, title: string, dueAt: number): Promise<Commitment> {
  const d = await db();
  const now = Date.now();
  const res = await d.runAsync(
    'INSERT INTO commitments(coach, title, due_at, created_at) VALUES(?, ?, ?, ?)',
    coachId,
    title,
    dueAt,
    now,
  );
  const id = res.lastInsertRowId;
  const lines = await nagLines(coachId, title, new Date(dueAt));
  const ids = await scheduleChain(id, title, dueAt, lines, coach(coachId).name).catch(() => [] as string[]);
  await d.runAsync('UPDATE commitments SET notification_ids = ? WHERE id = ?', JSON.stringify(ids), id);
  return (await d.getFirstAsync<Commitment>('SELECT * FROM commitments WHERE id = ?', id))!;
}

export async function setCommitmentStatus(id: number, status: Commitment['status']) {
  const d = await db();
  const c = await d.getFirstAsync<Commitment>('SELECT * FROM commitments WHERE id = ?', id);
  if (!c) return;
  await cancelIds(JSON.parse(c.notification_ids || '[]'));
  await d.runAsync(
    'UPDATE commitments SET status = ?, done_at = ?, notification_ids = ? WHERE id = ?',
    status,
    status === 'done' ? Date.now() : null,
    '[]',
    id,
  );
}

export async function snoozeCommitment(id: number, minutes = 30) {
  const d = await db();
  const c = await d.getFirstAsync<Commitment>('SELECT * FROM commitments WHERE id = ?', id);
  if (!c) return;
  await cancelIds(JSON.parse(c.notification_ids || '[]'));
  const due = Date.now() + minutes * 60_000;
  const lines: NagLines = [
    `Snooze over: ${c.title}.`,
    `${c.title}. You already snoozed once.`,
    `Two snoozes is a pattern. ${c.title}, now.`,
  ];
  const ids = await scheduleChain(id, c.title, due, lines, coach(c.coach).name);
  await d.runAsync('UPDATE commitments SET due_at = ?, notification_ids = ? WHERE id = ?', due, JSON.stringify(ids), id);
}

export async function openCommitments(): Promise<Commitment[]> {
  return (await db()).getAllAsync<Commitment>("SELECT * FROM commitments WHERE status = 'open' ORDER BY due_at");
}

export async function commitmentsForDay(day = new Date()): Promise<Commitment[]> {
  const from = startOfDay(day);
  return (await db()).getAllAsync<Commitment>(
    "SELECT * FROM commitments WHERE (due_at >= ? AND due_at < ?) OR (status = 'open' AND due_at < ?) ORDER BY status = 'open' DESC, due_at",
    from,
    from + 86_400_000,
    from,
  );
}

// Anything still open 6 hours after its due time counts as missed.
export async function sweepMissed() {
  await (await db()).runAsync(
    "UPDATE commitments SET status = 'missed' WHERE status = 'open' AND due_at < ?",
    Date.now() - 6 * 3_600_000,
  );
}

export async function recentStats(days = 7) {
  const since = Date.now() - days * 86_400_000;
  const rows = await (await db()).getAllAsync<{ status: string; n: number }>(
    'SELECT status, COUNT(*) n FROM commitments WHERE due_at >= ? AND due_at <= ? GROUP BY status',
    since,
    Date.now(),
  );
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return { done: by.done ?? 0, missed: by.missed ?? 0, open: by.open ?? 0 };
}
