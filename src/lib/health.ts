import { Platform } from 'react-native';
import { addDays, db, dayKey, kvGet, kvSet, parseDayKey, startOfDay, Workout } from './db';

// Samsung Health → Health Connect → Kairos.
// Samsung Health shares steps, workouts, sleep, weight and cycle data with
// Health Connect (Samsung Health → Settings → Health Connect). Kairos only
// reads. Everything here degrades to "not connected" outside Android or in
// Expo Go, where the native module isn't present.

type HC = typeof import('react-native-health-connect');
let hc: HC | null | undefined;

function lib(): HC | null {
  if (hc !== undefined) return hc;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hc = Platform.OS === 'android' ? (require('react-native-health-connect') as HC) : null;
  } catch {
    hc = null;
  }
  return hc;
}

const READS = ['Steps', 'ExerciseSession', 'SleepSession', 'Weight', 'ActiveCaloriesBurned', 'MenstruationPeriod', 'MenstruationFlow'] as const;

let ready = false;
async function init(): Promise<HC | null> {
  const h = lib();
  if (!h) return null;
  if (!ready) ready = await h.initialize().catch(() => false);
  return ready ? h : null;
}

export async function healthAvailable(): Promise<boolean> {
  const h = lib();
  if (!h) return false;
  try {
    return (await h.getSdkStatus()) === h.SdkAvailabilityStatus.SDK_AVAILABLE;
  } catch {
    return false;
  }
}

export async function connectHealth(): Promise<boolean> {
  const h = await init();
  if (!h) throw new Error('Health Connect is not available. It needs the Android development build (not Expo Go) and Health Connect installed.');
  const granted = await h.requestPermission(READS.map((recordType) => ({ accessType: 'read' as const, recordType })));
  await kvSet('health_connected', granted.length ? '1' : '0');
  return granted.length > 0;
}

export async function healthConnected(): Promise<boolean> {
  if ((await kvGet('health_connected')) !== '1') return false;
  const h = await init();
  if (!h) return false;
  try {
    return (await h.getGrantedPermissions()).length > 0;
  } catch {
    return false;
  }
}

export function openHealthSettings() {
  lib()?.openHealthConnectSettings();
}

const range = (from: Date, to: Date) => ({ operator: 'between' as const, startTime: from.toISOString(), endTime: to.toISOString() });

export type DayActivity = { day: string; steps: number; activeKcal: number };
export type HealthSnapshot = {
  today: DayActivity;
  week: DayActivity[]; // last 7 days, oldest first
  sleepHours: number | null; // last night
  weightKg: number | null; // latest in 60 days
  sessions: { title: string; minutes: number; start: string }[]; // last 14 days
};

// Exercise type ids → readable names.
function exerciseName(h: HC, type: number, title?: string) {
  if (title) return title;
  const entry = Object.entries(h.ExerciseType).find(([, v]) => v === type);
  return entry ? entry[0].toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Workout';
}

export async function snapshot(): Promise<HealthSnapshot | null> {
  if (!(await healthConnected())) return null;
  const h = (await init())!;
  const end = new Date();
  const weekStart = startOfDay(addDays(new Date(), -6));

  const [steps, kcal] = await Promise.all([
    h
      .aggregateGroupByPeriod({ recordType: 'Steps', timeRangeFilter: range(new Date(weekStart), end), timeRangeSlicer: { period: 'DAYS', length: 1 } })
      .catch(() => []),
    h
      .aggregateGroupByPeriod({
        recordType: 'ActiveCaloriesBurned',
        timeRangeFilter: range(new Date(weekStart), end),
        timeRangeSlicer: { period: 'DAYS', length: 1 },
      })
      .catch(() => []),
  ]);
  const week: DayActivity[] = [];
  for (let i = 0; i < 7; i++) {
    const day = dayKey(addDays(new Date(weekStart), i));
    const s = steps.find((g) => dayKey(new Date(g.startTime)) === day);
    const k = kcal.find((g) => dayKey(new Date(g.startTime)) === day);
    week.push({
      day,
      steps: Math.round(s?.result.COUNT_TOTAL ?? 0),
      activeKcal: Math.round(k?.result.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? 0),
    });
  }

  const [sleep, weight, sessions] = await Promise.all([
    h.readRecords('SleepSession', { timeRangeFilter: range(addDays(new Date(), -2), end) }).catch(() => null),
    h.readRecords('Weight', { timeRangeFilter: range(addDays(new Date(), -60), end), ascendingOrder: false, pageSize: 1 }).catch(() => null),
    h.readRecords('ExerciseSession', { timeRangeFilter: range(addDays(new Date(), -14), end), ascendingOrder: false, pageSize: 30 }).catch(() => null),
  ]);
  const lastSleep = sleep?.records.at(-1);
  const list = (sessions?.records ?? []).map((r) => ({
    id: r.metadata?.id ?? r.startTime,
    title: exerciseName(h, r.exerciseType, r.title),
    minutes: Math.round((Date.parse(r.endTime) - Date.parse(r.startTime)) / 60_000),
    start: r.startTime,
  }));
  // Keep Samsung Health workouts in the local log too, so the coach sees one history.
  const d = await db();
  for (const s of list)
    await d.runAsync(
      'INSERT OR IGNORE INTO workouts(title, minutes, details, source, ext_id, created_at) VALUES(?, ?, ?, ?, ?, ?)',
      s.title,
      s.minutes,
      null,
      'samsung',
      s.id,
      Date.parse(s.start),
    );

  return {
    today: week[6],
    week,
    sleepHours: lastSleep ? Math.round(((Date.parse(lastSleep.endTime) - Date.parse(lastSleep.startTime)) / 3_600_000) * 10) / 10 : null,
    weightKg: weight?.records[0]?.weight.inKilograms ? Math.round(weight.records[0].weight.inKilograms * 10) / 10 : null,
    sessions: list.map(({ title, minutes, start }) => ({ title, minutes, start })),
  };
}

// ---------- workouts you report ----------

export async function logWorkout(title: string, minutes: number | null, details: string | null, at = Date.now()) {
  const d = await db();
  // The same workout told twice on the same day is one workout.
  const dayStart = startOfDay(new Date(at));
  const same = await d.getFirstAsync<{ id: number }>(
    'SELECT id FROM workouts WHERE lower(title) = lower(?) AND created_at >= ? AND created_at < ?',
    title,
    dayStart,
    dayStart + 86_400_000,
  );
  if (same) {
    await d.runAsync('UPDATE workouts SET minutes = COALESCE(?, minutes), details = COALESCE(?, details) WHERE id = ?', minutes, details, same.id);
    return;
  }
  await d.runAsync(
    'INSERT INTO workouts(title, minutes, details, source, created_at) VALUES(?, ?, ?, ?, ?)',
    title,
    minutes,
    details,
    'manual',
    at,
  );
}

export async function recentWorkouts(days = 14): Promise<Workout[]> {
  return (await db()).getAllAsync<Workout>(
    'SELECT * FROM workouts WHERE created_at >= ? ORDER BY created_at DESC',
    Date.now() - days * 86_400_000,
  );
}

// ---------- cycle ----------

export type CycleInfo = {
  starts: string[]; // period start days, newest first
  periodDays: string[]; // every logged period day (last 6 months)
  avgLength: number | null;
  cycleDay: number | null;
  phase: 'Menstrual' | 'Follicular' | 'Ovulatory' | 'Luteal' | null;
  nextStart: string | null;
  lateBy: number | null;
};

export async function logPeriodDay(day = dayKey(), on = true) {
  const d = await db();
  if (on) await d.runAsync("INSERT OR IGNORE INTO cycle_log(day, kind, created_at) VALUES(?, 'period', ?)", day, Date.now());
  else await d.runAsync("DELETE FROM cycle_log WHERE day = ? AND kind = 'period'", day);
}

export async function logSymptom(note: string, day = dayKey()) {
  const d = await db();
  if (await d.getFirstAsync("SELECT 1 FROM cycle_log WHERE day = ? AND kind = 'symptom' AND lower(note) = lower(?)", day, note)) return;
  await d.runAsync("INSERT INTO cycle_log(day, kind, note, created_at) VALUES(?, 'symptom', ?, ?)", day, note, Date.now());
}

export async function recentSymptoms(days = 35): Promise<{ day: string; note: string }[]> {
  return (await db()).getAllAsync<{ day: string; note: string }>(
    "SELECT day, note FROM cycle_log WHERE kind = 'symptom' AND day >= ? ORDER BY day DESC LIMIT 20",
    dayKey(addDays(new Date(), -days)),
  );
}

export async function cycleInfo(): Promise<CycleInfo> {
  const since = addDays(new Date(), -190);
  const days = new Set(
    (
      await (await db()).getAllAsync<{ day: string }>("SELECT day FROM cycle_log WHERE kind = 'period' AND day >= ?", dayKey(since))
    ).map((r) => r.day),
  );
  // Merge in Samsung Health's period days via Health Connect.
  if (await healthConnected()) {
    const h = (await init())!;
    const [periods, flows] = await Promise.all([
      h.readRecords('MenstruationPeriod', { timeRangeFilter: range(since, new Date()) }).catch(() => null),
      h.readRecords('MenstruationFlow', { timeRangeFilter: range(since, new Date()) }).catch(() => null),
    ]);
    for (const p of periods?.records ?? []) {
      const r = p as unknown as { startTime?: string; endTime?: string; time?: string };
      if (r.startTime && r.endTime) {
        for (let t = new Date(r.startTime); t <= new Date(r.endTime); t = addDays(t, 1)) days.add(dayKey(t));
      } else if (r.time) days.add(dayKey(new Date(r.time)));
    }
    for (const f of flows?.records ?? []) if (f.flow !== 0) days.add(dayKey(new Date(f.time)));
  }

  const sorted = [...days].sort();
  // A new period starts after 7+ days without bleeding.
  const starts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const prev = i > 0 ? parseDayKey(sorted[i - 1]) : null;
    if (!prev || (parseDayKey(sorted[i]).getTime() - prev.getTime()) / 86_400_000 > 7) starts.push(sorted[i]);
  }
  starts.reverse();
  const lengths = starts
    .slice(0, -1)
    .map((s, i) => Math.round((parseDayKey(s).getTime() - parseDayKey(starts[i + 1]).getTime()) / 86_400_000))
    .filter((n) => n >= 18 && n <= 90);
  const avgLength = lengths.length ? Math.round(lengths.slice(0, 6).reduce((a, b) => a + b, 0) / Math.min(6, lengths.length)) : null;
  const cycleDay = starts[0] ? Math.floor((startOfDay() - parseDayKey(starts[0]).getTime()) / 86_400_000) + 1 : null;
  const len = avgLength ?? 32; // PCOS cycles tend to run long
  let phase: CycleInfo['phase'] = null;
  if (cycleDay != null) {
    const ovulation = len - 14;
    if (days.has(dayKey()) || cycleDay <= 5) phase = 'Menstrual';
    else if (cycleDay < ovulation - 1) phase = 'Follicular';
    else if (cycleDay <= ovulation + 1) phase = 'Ovulatory';
    else phase = 'Luteal';
  }
  const nextStart = starts[0] ? dayKey(addDays(parseDayKey(starts[0]), len)) : null;
  const lateBy = nextStart && nextStart < dayKey() ? Math.round((startOfDay() - parseDayKey(nextStart).getTime()) / 86_400_000) : null;
  return { starts, periodDays: sorted, avgLength, cycleDay, phase, nextStart, lateBy };
}
