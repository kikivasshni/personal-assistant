import * as SQLite from 'expo-sqlite';

// All app data lives in one SQLite file on the phone. Every coach reads the
// same tables, which is what gives them a shared memory.

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coach TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','model','note')),
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_coach ON messages(coach, created_at);

  CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    coach TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coach TEXT NOT NULL,
    title TEXT NOT NULL,
    due_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','missed','dropped')),
    notification_ids TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    done_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS feed_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    embed_url TEXT,
    title TEXT,
    thumb TEXT,
    coach TEXT NOT NULL DEFAULT 'hq',
    saved INTEGER NOT NULL DEFAULT 0,
    seen_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS food_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    kcal REAL, protein REAL, carbs REAL, fat REAL, fibre REAL,
    gl TEXT,
    note TEXT,
    photo_uri TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    statement TEXT NOT NULL,
    date TEXT NOT NULL,
    merchant TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT,
    needs_review INTEGER NOT NULL DEFAULT 0,
    question TEXT
  );

  CREATE TABLE IF NOT EXISTS merchant_rules (
    merchant TEXT PRIMARY KEY,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    flashcards TEXT NOT NULL DEFAULT '[]',
    notion_url TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS moods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mood INTEGER NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS briefings (
    day TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2: spaces and cards, tasks, desires, songs, practice, workouts, cycle.
  `
  CREATE TABLE IF NOT EXISTS custom_threads (
    id TEXT PRIMARY KEY,
    space TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'sparkles',
    focus TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS desires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    detail TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','manifested','released')),
    scene TEXT,
    story TEXT,
    created_at INTEGER NOT NULL,
    manifested_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT,
    status TEXT NOT NULL DEFAULT 'learning' CHECK (status IN ('wishlist','learning','learned')),
    notes TEXT,
    tabs TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS practice_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread TEXT NOT NULL,
    minutes INTEGER,
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_practice_thread ON practice_log(thread, created_at);

  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    minutes INTEGER,
    details TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    ext_id TEXT UNIQUE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cycle_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('period','symptom')),
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_period_day ON cycle_log(day) WHERE kind = 'period';

  CREATE TABLE IF NOT EXISTS task_links (
    ms_id TEXT PRIMARY KEY,
    notion_id TEXT,
    done INTEGER NOT NULL DEFAULT 0
  );

  ALTER TABLE transactions ADD COLUMN note TEXT;

  UPDATE messages SET coach = 'health.move' WHERE coach = 'health';
  UPDATE messages SET coach = 'study.aws' WHERE coach = 'academics';
  UPDATE messages SET coach = 'hobby.guitar' WHERE coach = 'hobbies';
  UPDATE messages SET coach = 'manifest.desires' WHERE coach = 'manifest';
  UPDATE messages SET coach = 'finance.advisor' WHERE coach = 'finance';
  `,
  // v3: two-way Notion sync. One row per synced record: which Notion page it
  // is, and a fingerprint of the fields as last agreed by both sides.
  // notion_id '' means "detached": deleted in Notion, kept in the app.
  `
  CREATE TABLE IF NOT EXISTS notion_links (
    kind TEXT NOT NULL,
    local_id INTEGER NOT NULL,
    notion_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (kind, local_id)
  );
  CREATE INDEX IF NOT EXISTS idx_notion_links_page ON notion_links(notion_id);
  `,
];

async function open() {
  // enableChangeListener powers live screens (src/lib/live.ts).
  const d = await SQLite.openDatabaseAsync('oracle.db', { enableChangeListener: true });
  await d.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await d.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await d.withTransactionAsync(async () => {
      await d.execAsync(MIGRATIONS[version]);
    });
    version += 1;
    await d.execAsync(`PRAGMA user_version = ${version}`);
  }
  return d;
}

// ---------- tiny typed helpers ----------

export type Message = { id: number; coach: string; role: 'user' | 'model' | 'note'; text: string; created_at: number };
export type Fact = { id: number; text: string; coach: string | null; created_at: number };
export type Commitment = {
  id: number;
  coach: string;
  title: string;
  due_at: number;
  status: 'open' | 'done' | 'missed' | 'dropped';
  notification_ids: string;
  created_at: number;
  done_at: number | null;
};
export type FeedItem = {
  id: number;
  source: 'youtube' | 'tiktok' | 'instagram' | 'pinterest' | 'link';
  url: string;
  embed_url: string | null;
  title: string | null;
  thumb: string | null;
  coach: string;
  saved: number;
  seen_at: number | null;
  created_at: number;
};
export type Food = {
  id: number;
  description: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fibre: number | null;
  gl: string | null;
  note: string | null;
  photo_uri: string | null;
  created_at: number;
};
export type Txn = {
  id: number;
  statement: string;
  date: string;
  merchant: string;
  amount: number;
  category: string | null;
  needs_review: number;
  question: string | null;
  note: string | null;
};
export type Desire = {
  id: number;
  title: string;
  detail: string | null;
  status: 'pending' | 'manifested' | 'released';
  scene: string | null;
  story: string | null;
  created_at: number;
  manifested_at: number | null;
};
export type Song = {
  id: number;
  title: string;
  artist: string | null;
  status: 'wishlist' | 'learning' | 'learned';
  notes: string | null;
  tabs: string | null;
  created_at: number;
  updated_at: number;
};
export type Workout = {
  id: number;
  title: string;
  minutes: number | null;
  details: string | null;
  source: string;
  ext_id: string | null;
  created_at: number;
};
export type Mood = { id: number; mood: number; note: string | null; created_at: number };
export type Note = {
  id: number;
  module: string | null;
  title: string;
  body: string;
  flashcards: string;
  notion_url: string | null;
  created_at: number;
};

export async function kvGet(key: string): Promise<string | null> {
  const r = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return r?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  await (await db()).runAsync(
    'INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export function startOfDay(d = new Date()): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Whole-database export for backups. Returns plain JSON.
export async function exportAll(): Promise<Record<string, unknown[]>> {
  const d = await db();
  const out: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) out[t] = await d.getAllAsync(`SELECT * FROM ${t}`);
  return out;
}

// Replaces every table in the backup with its rows, in one transaction: if
// anything fails, nothing changes. Only columns that exist today are copied,
// so a backup from an older or newer version of the app still restores.
// Returns the number of rows restored.
export async function restoreAll(data: Record<string, unknown>): Promise<number> {
  const d = await db();
  let rows = 0;
  await d.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await d.withTransactionAsync(async () => {
      for (const t of BACKUP_TABLES) {
        const list = data[t];
        if (!Array.isArray(list)) continue;
        const cols = new Set((await d.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
        if (!cols.size) continue;
        await d.runAsync(`DELETE FROM ${t}`);
        for (const row of list) {
          if (!row || typeof row !== 'object') continue;
          const entries = Object.entries(row as Record<string, unknown>).filter(([k]) => cols.has(k));
          if (!entries.length) continue;
          await d.runAsync(
            `INSERT OR REPLACE INTO ${t} (${entries.map(([k]) => `"${k}"`).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`,
            entries.map(([, v]) => (v === undefined ? null : (v as string | number | null))),
          );
          rows++;
        }
      }
    });
  } finally {
    await d.execAsync('PRAGMA foreign_keys = ON;');
  }
  return rows;
}

const BACKUP_TABLES = [
  'messages',
  'facts',
  'commitments',
  'feed_items',
  'food_log',
  'transactions',
  'merchant_rules',
  'notes',
  'moods',
  'briefings',
  'kv',
  'custom_threads',
  'desires',
  'songs',
  'practice_log',
  'workouts',
  'cycle_log',
  'task_links',
];
