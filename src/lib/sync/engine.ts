import { db } from '../db';
import { call, NotionNode } from '../integrations/notion';

// Two-way sync between a local SQLite table and a Notion database.
//
// Each record is reduced to a "canonical" object: just the fields both sides
// share, normalised the same way whichever side it came from. A fingerprint
// of the canonical object as last agreed is stored in notion_links. On each
// sync the app compares both sides against that fingerprint:
//
//   only the app changed    → push to Notion
//   only Notion changed     → apply to the app
//   both changed            → the app wins (it's where you act most)
//   deleted in the app      → archive the Notion page
//   deleted in Notion       → delete in the app (or detach, for kinds that
//                             shouldn't be deleted from Notion)
//   new in the app          → create in Notion, or adopt an identical existing
//                             Notion row (so nothing is duplicated)
//   new in Notion           → create in the app (for kinds that allow it)
//
// Nothing is deleted on either side unless the Notion scan was complete.

export type Value = string | number | boolean | null;
export type Canon = Record<string, Value>;
export type Page = { id: string; archived?: boolean; in_trash?: boolean; properties: Record<string, Prop> };
export type Prop = Record<string, unknown> & { type: string };

export type LocalRow = {
  id: number;
  canon: Canon;
  createExtra?: Record<string, unknown>; // props set only when the page is first created
  noCreate?: boolean; // old history: link to an existing Notion row if there is one, never create
};

export type Mirror = {
  kind: string; // link namespace, e.g. 'food'
  tables: string[]; // local tables whose changes should trigger this sync
  findDb: (nodes: NotionNode[]) => Promise<string | null | undefined> | string | null | undefined;
  localRows: () => Promise<LocalRow[]>;
  toProps: (c: Canon, creating: boolean) => Record<string, unknown> | Promise<Record<string, unknown>>;
  fromPage: (p: Page) => Canon | null; // null: not ours / not valid, leave it alone
  matchKey: (c: Canon) => string; // identity for adopting existing rows
  applyLocal: (id: number, c: Canon) => Promise<void>;
  insertLocal?: (c: Canon) => Promise<number | null>; // omit: rows made in Notion aren't imported
  deleteLocal?: (id: number) => Promise<void>; // omit: deleting in Notion just detaches
  skipPage?: (pageId: string) => Promise<boolean> | boolean; // pages owned by another sync
};

// ---------- property helpers (plain text, so values round-trip exactly) ----------

export const txt = (s: string | null | undefined) => ({
  rich_text: s ? chunk(s).map((content) => ({ text: { content } })) : [],
});
export const ttl = (s: string) => ({ title: chunk(s || 'Untitled').map((content) => ({ text: { content } })) });
export const num = (n: number | null | undefined) => ({ number: n == null || Number.isNaN(n) ? null : n });
export const day = (d: string | null | undefined) => ({ date: d ? { start: d } : null });
export const sel = (s: string | null | undefined) => ({ select: s ? { name: s } : null });

function chunk(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length && out.length < 90; i += 1900) out.push(s.slice(i, i + 1900));
  return out.length ? out : [''];
}

const joined = (arr: unknown) => ((arr as { plain_text?: string }[] | undefined) ?? []).map((r) => r.plain_text ?? '').join('');

export const read = {
  title: (p: Page) => joined(Object.values(p.properties).find((x) => x.type === 'title')?.title).trim(),
  text: (p: Page, name: string) => {
    const v = joined(p.properties[name]?.rich_text).trim();
    return v || null;
  },
  num: (p: Page, name: string) => (p.properties[name]?.number as number | null | undefined) ?? null,
  date: (p: Page, name: string) => ((p.properties[name]?.date as { start?: string } | null)?.start ?? null),
  select: (p: Page, name: string) => ((p.properties[name]?.select as { name?: string } | null)?.name ?? null),
  multi: (p: Page, name: string) => ((p.properties[name]?.multi_select as { name: string }[] | undefined) ?? []).map((o) => o.name),
  checkbox: (p: Page, name: string) => !!p.properties[name]?.checkbox,
};

/** Rounds like Notion number columns are shown, so both sides agree. */
export const r1 = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);
/** Empty strings and missing values are the same thing. */
export const s0 = (s: string | null | undefined) => {
  const t = (s ?? '').trim();
  return t ? t : null;
};

export function fingerprint(c: Canon): string {
  return JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k] ?? null]));
}

// ---------- Notion I/O ----------

const MAX_PAGES = 15; // ×100 rows

async function scan(dbId: string): Promise<{ pages: Page[]; complete: boolean }> {
  const pages: Page[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = (await call(`/databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    })) as { results: Page[]; has_more: boolean; next_cursor: string | null };
    pages.push(...r.results.filter((p) => !p.archived && !p.in_trash));
    if (!r.has_more || !r.next_cursor) return { pages, complete: true };
    cursor = r.next_cursor;
  }
  return { pages, complete: false };
}

const clean = (id: string) => id.replace(/-/g, '');

// ---------- the sync ----------

export type SyncResult = { kind: string; pushed: number; pulled: number; created: number; imported: number; deleted: number; skipped?: string };

type Link = { kind: string; local_id: number; notion_id: string; hash: string };

export async function syncMirror(m: Mirror, nodes: NotionNode[]): Promise<SyncResult> {
  const res: SyncResult = { kind: m.kind, pushed: 0, pulled: 0, created: 0, imported: 0, deleted: 0 };
  const dbId = await m.findDb(nodes);
  if (!dbId) return { ...res, skipped: 'no database' };

  const d = await db();
  const { pages, complete } = await scan(dbId);
  const local = await m.localRows();
  const links = await d.getAllAsync<Link>('SELECT * FROM notion_links WHERE kind = ?', m.kind);

  const localById = new Map(local.map((r) => [r.id, r]));
  const pageById = new Map(pages.map((p) => [clean(p.id), p]));
  const claimed = new Set(links.map((l) => l.notion_id).filter(Boolean));
  // A scan that suddenly sees almost nothing is more likely lost access than
  // mass deletion: don't delete anything from the app on it.
  const linkedLive = links.filter((l) => l.notion_id && pageById.has(l.notion_id)).length;
  const linkedAll = links.filter((l) => l.notion_id).length;
  const lostAccess = (pages.length === 0 && linkedAll > 0) || (linkedAll >= 5 && linkedLive < linkedAll * 0.5);
  const safeToDelete = complete && !lostAccess;

  const setLink = (localId: number, notionId: string, hash: string) =>
    d.runAsync(
      'INSERT INTO notion_links(kind, local_id, notion_id, hash) VALUES(?, ?, ?, ?) ON CONFLICT(kind, local_id) DO UPDATE SET notion_id = excluded.notion_id, hash = excluded.hash',
      m.kind,
      localId,
      notionId,
      hash,
    );
  const dropLink = (localId: number) => d.runAsync('DELETE FROM notion_links WHERE kind = ? AND local_id = ?', m.kind, localId);
  const update = async (pageId: string, c: Canon) =>
    call(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties: await m.toProps(c, false) }) });
  const create = async (row: LocalRow) =>
    (await call('/pages', {
      method: 'POST',
      body: JSON.stringify({ parent: { database_id: dbId }, properties: { ...(await m.toProps(row.canon, true)), ...(row.createExtra ?? {}) } }),
    })) as { id: string };

  // 1. Records already linked.
  for (const link of links) {
    const row = localById.get(link.local_id);
    if (link.notion_id === '') {
      // Detached: deleted in Notion, kept in the app. Forget it once it's gone here too.
      if (!row) await dropLink(link.local_id);
      continue;
    }
    const page = pageById.get(link.notion_id);
    if (row && page) {
      const lh = fingerprint(row.canon);
      const nc = m.fromPage(page);
      const nh = nc ? fingerprint(nc) : link.hash;
      if (lh === nh) {
        if (link.hash !== lh) await setLink(row.id, link.notion_id, lh);
      } else if (nc && lh === link.hash) {
        await m.applyLocal(row.id, nc); // edited in Notion
        await setLink(row.id, link.notion_id, nh);
        res.pulled++;
      } else {
        await update(link.notion_id, row.canon); // edited in the app (or both)
        await setLink(row.id, link.notion_id, lh);
        res.pushed++;
      }
    } else if (row && !page) {
      if (!safeToDelete) continue;
      if (m.deleteLocal) {
        await m.deleteLocal(row.id); // deleted in Notion
        await dropLink(row.id);
        res.deleted++;
      } else {
        await setLink(row.id, '', link.hash);
      }
    } else if (!row && page) {
      await call(`/pages/${link.notion_id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }); // deleted in the app
      await dropLink(link.local_id);
      res.deleted++;
    } else {
      await dropLink(link.local_id);
    }
  }

  // 2. New in the app: adopt a matching Notion row, or create one.
  const linkedLocal = new Set(links.map((l) => l.local_id));
  const unclaimed = new Map<string, Page[]>();
  const skip = new Set<string>();
  for (const p of pages) {
    const id = clean(p.id);
    if (claimed.has(id)) continue;
    if (m.skipPage && (await m.skipPage(id))) {
      skip.add(id);
      continue;
    }
    const c = m.fromPage(p);
    if (!c) continue;
    const key = m.matchKey(c);
    unclaimed.set(key, [...(unclaimed.get(key) ?? []), p]);
  }
  for (const row of local) {
    if (linkedLocal.has(row.id)) continue;
    const match = unclaimed.get(m.matchKey(row.canon))?.shift();
    if (match) {
      const id = clean(match.id);
      const nc = m.fromPage(match)!;
      if (fingerprint(nc) !== fingerprint(row.canon)) await update(id, row.canon);
      await setLink(row.id, id, fingerprint(row.canon));
      claimed.add(id);
    } else if (!row.noCreate) {
      const page = await create(row);
      await setLink(row.id, clean(page.id), fingerprint(row.canon));
      claimed.add(clean(page.id));
      res.created++;
    }
  }

  // 3. New in Notion: bring it into the app.
  if (m.insertLocal) {
    for (const list of unclaimed.values()) {
      for (const p of list) {
        const id = clean(p.id);
        if (claimed.has(id) || skip.has(id)) continue;
        const c = m.fromPage(p);
        if (!c) continue;
        const localId = await m.insertLocal(c);
        if (localId == null) continue;
        await setLink(localId, id, fingerprint(c));
        claimed.add(id);
        res.imported++;
      }
    }
  }
  return res;
}
