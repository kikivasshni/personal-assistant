import { AppState } from 'react-native';
import { kvGet, kvSet } from '../db';
import { call, NotionNode, workspaceMap } from '../integrations/notion';
import { onDataChange } from '../live';
import { getSecret } from '../secrets';
import { fingerprint, Mirror, Page, read, syncMirror, SyncResult, ttl, txt } from './engine';
import { MIRRORS, PROFILE_ROW } from './mirrors';

// Keeps Notion in step with the app, both ways:
// - a change in the app syncs its table a few seconds later
// - everything syncs when the app opens or comes back, and every 5 minutes
//   while it's open, which is how edits made in Notion arrive

const PERIOD = 5 * 60_000;
const DEBOUNCE = 2500;

export type SyncStatus = { at: number; ok: boolean; error?: string; results: SyncResult[] };
let status: SyncStatus | null = null;
const listeners = new Set<(s: SyncStatus) => void>();

export function syncStatus(): SyncStatus | null {
  return status;
}
export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// One run per kind at a time; a change during a run queues one more.
const running = new Map<string, Promise<void>>();
const again = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

async function nodes(): Promise<NotionNode[]> {
  // Fresh enough to notice a newly shared or renamed database.
  return workspaceMap(30 * 60_000);
}

function run(kind: string, job: () => Promise<void>): Promise<void> {
  const cur = running.get(kind);
  if (cur) {
    again.add(kind);
    return cur;
  }
  const p = job()
    .catch(() => {})
    .finally(() => {
      running.delete(kind);
      if (again.delete(kind)) void run(kind, job);
    });
  running.set(kind, p);
  return p;
}

function schedule(kind: string) {
  const t = timers.get(kind);
  if (t) clearTimeout(t);
  timers.set(
    kind,
    setTimeout(() => {
      timers.delete(kind);
      const m = MIRRORS.find((x) => x.kind === kind);
      if (m) void run(kind, async () => void (await syncMirrorSafe(m)));
      else if (kind === 'profile') void run(kind, async () => void (await syncProfileText()));
    }, DEBOUNCE),
  );
}

async function syncMirrorSafe(m: Mirror): Promise<SyncResult> {
  return syncMirror(m, await nodes());
}

// ---------- profile text ↔ the "Basics" row of profile ----------

async function syncProfileText(): Promise<SyncResult> {
  const res: SyncResult = { kind: 'profile', pushed: 0, pulled: 0, created: 0, imported: 0, deleted: 0 };
  const dbId = (await nodes()).find((n) => n.kind === 'database' && /^profile$/i.test(n.title.trim()))?.id;
  if (!dbId) return { ...res, skipped: 'no database' };
  const r = (await call(`/databases/${dbId}/query`, { method: 'POST', body: JSON.stringify({ page_size: 100 }) })) as { results: Page[] };
  const page = r.results.find((p) => !p.archived && !p.in_trash && PROFILE_ROW.test(read.title(p)));
  const local = await kvGet('profile');
  const last = await kvGet('notion_profile_hash');
  const h = (s: string) => fingerprint({ t: s.trim() });

  if (!page) {
    if (local?.trim()) {
      await call('/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: dbId }, properties: { Name: ttl('Basics'), Context: txt(local) } }) });
      await kvSet('notion_profile_hash', h(local));
      res.created++;
    }
    return res;
  }
  const remote = read.text(page, 'Context') ?? '';
  if (local == null) {
    // Never edited in the app: take what's in Notion.
    if (remote) {
      await kvSet('profile', remote);
      await kvSet('notion_profile_hash', h(remote));
      res.pulled++;
    }
    return res;
  }
  const lh = h(local);
  const rh = h(remote);
  if (last == null && lh !== rh && remote.trim()) {
    // First sync and both sides have their own text: keep both, don't overwrite.
    const merged = remote.includes(local.trim()) ? remote : local.includes(remote.trim()) ? local : `${remote.trim()}\n\n${local.trim()}`;
    await call(`/pages/${page.id}`, { method: 'PATCH', body: JSON.stringify({ properties: { Context: txt(merged) } }) });
    await kvSet('profile', merged);
    await kvSet('notion_profile_hash', h(merged));
    res.pushed++;
    return res;
  }
  if (lh === rh) {
    if (last !== lh) await kvSet('notion_profile_hash', lh);
  } else if (lh === last) {
    await kvSet('profile', remote);
    await kvSet('notion_profile_hash', rh);
    res.pulled++;
  } else {
    await call(`/pages/${page.id}`, { method: 'PATCH', body: JSON.stringify({ properties: { Context: txt(local) } }) });
    await kvSet('notion_profile_hash', lh);
    res.pushed++;
  }
  return res;
}

// ---------- everything ----------

let lastAll = 0;

/** Syncs every table now. Safe to call often; overlapping calls share work. */
export async function syncAll(): Promise<SyncStatus | null> {
  if (!(await getSecret('notionToken'))) return null;
  lastAll = Date.now();
  const results: SyncResult[] = [];
  let error: string | undefined;
  for (const m of MIRRORS) {
    await run(m.kind, async () => {
      try {
        results.push(await syncMirrorSafe(m));
      } catch (e) {
        error = error ?? `${m.kind}: ${e instanceof Error ? e.message : String(e)}`;
      }
    });
  }
  await run('profile', async () => {
    try {
      results.push(await syncProfileText());
    } catch (e) {
      error = error ?? `profile: ${e instanceof Error ? e.message : String(e)}`;
    }
  });
  status = { at: Date.now(), ok: !error, error, results };
  listeners.forEach((l) => l(status!));
  await kvSet('notion_synced_at', String(status.at)).catch(() => {});
  return status;
}

let started = false;

/** Call once at app start. */
export function startNotionSync() {
  if (started) return;
  started = true;

  onDataChange((b) => {
    const all = b.tables.has('*');
    for (const m of MIRRORS) if (all || m.tables.some((t) => b.tables.has(t))) schedule(m.kind);
    if (all || b.tables.has('profile')) schedule('profile');
  });

  const tick = () => {
    if (AppState.currentState === 'active' && Date.now() - lastAll > 60_000) void syncAll();
  };
  AppState.addEventListener('change', (s) => s === 'active' && tick());
  setInterval(tick, PERIOD);
  setTimeout(() => void syncAll(), 4000);
}
