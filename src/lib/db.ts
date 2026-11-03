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
];

async function open() {
  const d = await SQLite.openDatabaseAsync('oracle.db');
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
};
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

export function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Whole-database export for backups. Returns plain JSON.
export async function exportAll(): Promise<Record<string, unknown[]>> {
  const d = await db();
  const tables = [
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
  ];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = await d.getAllAsync(`SELECT * FROM ${t}`);
  return out;
}
