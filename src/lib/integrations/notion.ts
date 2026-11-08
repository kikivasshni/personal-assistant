import { kvGet, kvSet } from '../db';
import { getSecret } from '../secrets';

// Notion through an internal integration token.
//
// Kairos doesn't need page links. It scans every page and database your
// integration can see and keeps a map (titles and parents). The coaches get
// that map in their context plus tools to search, read, append and create,
// so they can decide where a new note belongs and mirror how the
// neighbouring pages are written.

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

export async function call(path: string, init: RequestInit = {}) {
  const token = await getSecret('notionToken');
  if (!token) throw new Error('Notion is not connected. Add your integration token in You → Notion.');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
      },
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Notion ${res.status}: ${(json as { message?: string }).message ?? ''}`);
    return json as Record<string, unknown>;
  }
}

// Accept either a raw ID or a full Notion URL.
export function notionId(input: string): string {
  const m = input.replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return m ? m[0] : input.trim();
}

const short = (id: string) => id.replace(/-/g, '').slice(0, 8);

// ---------- Markdown <-> blocks ----------

type Block = Record<string, unknown>;
type RichText = { plain_text?: string; text?: { content: string }; annotations?: { bold?: boolean; code?: boolean; italic?: boolean } };

// Inline **bold**, *italic* and `code`, each run capped at Notion's 2000 chars.
export function rich(text: string): RichText[] {
  const out: RichText[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (content: string, annotations?: RichText['annotations']) => {
    for (let i = 0; i < content.length; i += 1900)
      out.push({ text: { content: content.slice(i, i + 1900) }, ...(annotations ? { annotations } : {}) });
  };
  while ((m = re.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) push(t.slice(2, -2), { bold: true });
    else if (t.startsWith('`')) push(t.slice(1, -1), { code: true });
    else push(t.slice(1, -1), { italic: true });
    last = m.index + t.length;
  }
  if (last < text.length) push(text.slice(last));
  return out.length ? out.slice(0, 90) : [{ text: { content: '' } }];
}

const textBlock = (type: string, text: string, extra: Record<string, unknown> = {}): Block => ({
  type,
  [type]: { rich_text: rich(text), ...extra },
});

// Headings, bullets, numbers, to-dos, quotes, code (``` incl. ```tab), tables, dividers.
export function markdownToBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^```\s*(\w*)/))) {
      const body: string[] = [];
      while (++i < lines.length && !lines[i].trimStart().startsWith('```')) body.push(lines[i]);
      const lang = m[1] === 'hcl' ? 'hcl' : m[1] && m[1] !== 'tab' ? m[1] : 'plain text';
      blocks.push({
        type: 'code',
        code: { rich_text: [{ text: { content: body.join('\n').slice(0, 1990) } }], language: lang },
      });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) continue; // separator row
        rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()));
      }
      i--;
      const width = Math.max(...rows.map((r) => r.length));
      blocks.push({
        type: 'table',
        table: {
          table_width: width,
          has_column_header: true,
          has_row_header: false,
          children: rows.slice(0, 99).map((r) => ({
            type: 'table_row',
            table_row: { cells: Array.from({ length: width }, (_, k) => rich(r[k] ?? '')) },
          })),
        },
      });
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) blocks.push({ type: 'divider', divider: {} });
    else if ((m = line.match(/^###\s+(.*)/))) blocks.push(textBlock('heading_3', m[1]));
    else if ((m = line.match(/^##\s+(.*)/))) blocks.push(textBlock('heading_2', m[1]));
    else if ((m = line.match(/^#\s+(.*)/))) blocks.push(textBlock('heading_1', m[1]));
    else if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)/))) blocks.push(textBlock('to_do', m[2], { checked: m[1] !== ' ' }));
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) blocks.push(textBlock('bulleted_list_item', m[1]));
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) blocks.push(textBlock('numbered_list_item', m[1]));
    else if ((m = line.match(/^>\s?(.*)/))) blocks.push(textBlock('quote', m[1]));
    else blocks.push(textBlock('paragraph', line));
  }
  return blocks;
}

export function plain(rt: unknown): string {
  return ((rt as RichText[] | undefined) ?? [])
    .map((r) => {
      const t = r.plain_text ?? r.text?.content ?? '';
      if (r.annotations?.code) return `\`${t}\``;
      if (r.annotations?.bold) return `**${t}**`;
      return t;
    })
    .join('');
}

function blockToMarkdown(b: Block): string {
  const type = b.type as string;
  const v = (b[type] ?? {}) as Record<string, unknown>;
  const t = plain(v.rich_text);
  switch (type) {
    case 'heading_1':
      return `# ${t}`;
    case 'heading_2':
      return `## ${t}`;
    case 'heading_3':
      return `### ${t}`;
    case 'bulleted_list_item':
      return `- ${t}`;
    case 'numbered_list_item':
      return `1. ${t}`;
    case 'to_do':
      return `- [${v.checked ? 'x' : ' '}] ${t}`;
    case 'quote':
    case 'callout':
      return `> ${t}`;
    case 'toggle':
      return `▸ ${t}`;
    case 'code':
      return '```\n' + t + '\n```';
    case 'divider':
      return '---';
    case 'child_page':
      return `[page] ${(v.title as string) ?? ''} (id ${short(String(b.id))})`;
    case 'child_database':
      return `[database] ${(v.title as string) ?? ''} (id ${short(String(b.id))})`;
    case 'table':
      return '[table]';
    case 'table_row':
      return `| ${((v.cells as unknown[]) ?? []).map(plain).join(' | ')} |`;
    case 'image':
      return '[image]';
    default:
      return t;
  }
}

// ---------- workspace map ----------

export type NotionNode = { id: string; title: string; kind: 'page' | 'database'; parent: string | null; url: string; edited: number };

type SearchResult = {
  object: 'page' | 'database';
  id: string;
  url: string;
  last_edited_time: string;
  archived?: boolean;
  in_trash?: boolean;
  parent: { type: string; page_id?: string; database_id?: string; block_id?: string };
  properties?: Record<string, { type: string; title?: RichText[] }>;
  title?: RichText[];
};

function titleOf(r: SearchResult): string {
  if (r.object === 'database') return plain(r.title) || 'Untitled database';
  const prop = Object.values(r.properties ?? {}).find((p) => p.type === 'title');
  return plain(prop?.title) || 'Untitled';
}

const MAP_KEY = 'notion_map';
const MAP_TTL = 6 * 3_600_000;
let memo: { at: number; nodes: NotionNode[] } | null = null;

export async function refreshMap(): Promise<NotionNode[]> {
  const nodes: NotionNode[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = (await call('/search', {
      method: 'POST',
      body: JSON.stringify({ page_size: 100, start_cursor: cursor, sort: { direction: 'descending', timestamp: 'last_edited_time' } }),
    })) as { results: SearchResult[]; has_more: boolean; next_cursor: string | null };
    for (const x of r.results) {
      if (x.archived || x.in_trash) continue;
      nodes.push({
        id: x.id.replace(/-/g, ''),
        title: titleOf(x).slice(0, 80),
        kind: x.object,
        parent: (x.parent.page_id ?? x.parent.database_id ?? x.parent.block_id ?? '').replace(/-/g, '') || null,
        url: x.url,
        edited: Date.parse(x.last_edited_time) || 0,
      });
    }
    if (!r.has_more || !r.next_cursor) break;
    cursor = r.next_cursor;
  }
  memo = { at: Date.now(), nodes };
  await kvSet(MAP_KEY, JSON.stringify(memo));
  return nodes;
}

export async function workspaceMap(maxAge = MAP_TTL): Promise<NotionNode[]> {
  if (!memo) {
    const raw = await kvGet(MAP_KEY);
    if (raw) memo = JSON.parse(raw);
  }
  if (memo && Date.now() - memo.at < maxAge) return memo.nodes;
  if (!(await getSecret('notionToken'))) return [];
  try {
    return await refreshMap();
  } catch {
    return memo?.nodes ?? [];
  }
}

export function findNode(nodes: NotionNode[], idOrUrl: string): NotionNode | undefined {
  const id = notionId(idOrUrl);
  return nodes.find((n) => n.id === id || n.id.startsWith(id));
}

// Indented outline of the workspace for the model. Rows in big databases
// are collapsed so the outline stays small.
export function outline(nodes: NotionNode[], maxLines = 160): string {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<string, NotionNode[]>();
  for (const n of nodes) {
    const p = n.parent && ids.has(n.parent) ? n.parent : 'root';
    kids.set(p, [...(kids.get(p) ?? []), n]);
  }
  const lines: string[] = [];
  const walk = (parent: string, depth: number) => {
    const list = (kids.get(parent) ?? []).sort((a, b) => a.title.localeCompare(b.title));
    const parentNode = nodes.find((n) => n.id === parent);
    const shown = parentNode?.kind === 'database' ? list.slice(0, 5) : list;
    for (const n of shown) {
      if (lines.length >= maxLines) return;
      lines.push(`${'  '.repeat(depth)}- ${n.kind === 'database' ? '[db] ' : ''}${n.title} (${short(n.id)})`);
      walk(n.id, depth + 1);
    }
    if (shown.length < list.length) lines.push(`${'  '.repeat(depth)}- …and ${list.length - shown.length} more rows`);
  };
  walk('root', 0);
  return lines.join('\n');
}

// Expands an 8-char short id from the outline back to a full id.
async function fullId(idOrUrl: string): Promise<string> {
  const id = notionId(idOrUrl);
  if (id.length === 32) return id;
  const n = findNode(await workspaceMap(), id);
  if (!n) throw new Error(`No Notion page with id ${id}. Use notion_search first.`);
  return n.id;
}

export async function search(query: string): Promise<NotionNode[]> {
  const nodes = await workspaceMap();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = nodes
    .map((n) => ({ n, s: words.filter((w) => n.title.toLowerCase().includes(w)).length }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.n.edited - a.n.edited)
    .map((x) => x.n);
  if (scored.length) return scored.slice(0, 15);
  // Fall back to Notion's own search, which also matches more loosely.
  const r = (await call('/search', { method: 'POST', body: JSON.stringify({ query, page_size: 15 }) })) as { results: SearchResult[] };
  return r.results.map((x) => ({
    id: x.id.replace(/-/g, ''),
    title: titleOf(x),
    kind: x.object,
    parent: null,
    url: x.url,
    edited: Date.parse(x.last_edited_time) || 0,
  }));
}

// Page (or database) contents as Markdown, for the model to read.
export async function readPage(idOrUrl: string, maxBlocks = 150): Promise<{ title: string; markdown: string; url: string }> {
  const id = await fullId(idOrUrl);
  const nodes = await workspaceMap();
  const node = findNode(nodes, id);
  if (node?.kind === 'database') {
    const r = (await call(`/databases/${id}/query`, { method: 'POST', body: JSON.stringify({ page_size: 30 }) })) as {
      results: SearchResult[];
    };
    return {
      title: node.title,
      url: node.url,
      markdown: r.results.map((x) => `- ${titleOf(x)} (${short(x.id)})`).join('\n') || '(empty database)',
    };
  }
  const out: string[] = [];
  let cursor: string | undefined;
  let count = 0;
  do {
    const r = (await call(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`)) as {
      results: (Block & { has_children?: boolean; id: string })[];
      has_more: boolean;
      next_cursor: string | null;
    };
    for (const b of r.results) {
      out.push(blockToMarkdown(b));
      count++;
      // One level of nesting for tables and toggles keeps structure visible.
      if (b.has_children && (b.type === 'table' || b.type === 'toggle') && count < maxBlocks) {
        const kids = (await call(`/blocks/${b.id}/children?page_size=50`)) as { results: Block[] };
        for (const k of kids.results) out.push((b.type === 'toggle' ? '  ' : '') + blockToMarkdown(k));
      }
    }
    cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined;
  } while (cursor && count < maxBlocks);
  return { title: node?.title ?? 'Page', url: node?.url ?? '', markdown: out.join('\n') || '(empty page)' };
}

export async function appendToPage(idOrUrl: string, markdown: string): Promise<string> {
  const id = await fullId(idOrUrl);
  const blocks = markdownToBlocks(markdown);
  for (let i = 0; i < blocks.length; i += 90) {
    await call(`/blocks/${id}/children`, { method: 'PATCH', body: JSON.stringify({ children: blocks.slice(i, i + 90) }) });
  }
  const n = findNode(await workspaceMap(), id);
  return n?.url ?? `https://notion.so/${id}`;
}

// Replaces a page's whole body (used for dashboards Kairos owns).
export async function replacePage(idOrUrl: string, markdown: string): Promise<void> {
  const id = await fullId(idOrUrl);
  let cursor: string | undefined;
  const old: string[] = [];
  do {
    const r = (await call(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`)) as {
      results: { id: string; type: string }[];
      has_more: boolean;
      next_cursor: string | null;
    };
    // Keep sub-pages (e.g. monthly reports) and only clear content blocks.
    old.push(...r.results.filter((b) => b.type !== 'child_page' && b.type !== 'child_database').map((b) => b.id));
    cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined;
  } while (cursor);
  for (const b of old) await call(`/blocks/${b}`, { method: 'DELETE' });
  await appendToPage(id, markdown);
}

async function databaseTitleProp(databaseId: string): Promise<string> {
  const info = (await call(`/databases/${databaseId}`)) as { properties: Record<string, { type: string }> };
  return Object.entries(info.properties).find(([, v]) => v.type === 'title')?.[0] ?? 'Name';
}

export async function createPage(parentIdOrUrl: string, title: string, markdown: string): Promise<NotionNode> {
  const parentId = await fullId(parentIdOrUrl);
  const nodes = await workspaceMap();
  const parent = findNode(nodes, parentId);
  const blocks = markdownToBlocks(markdown);
  const isDb = parent?.kind === 'database';
  const page = (await call('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: isDb ? { database_id: parentId } : { page_id: parentId },
      properties: isDb ? { [await databaseTitleProp(parentId)]: { title: rich(title) } } : { title: { title: rich(title) } },
      children: blocks.slice(0, 90),
    }),
  })) as { id: string; url: string };
  const id = page.id.replace(/-/g, '');
  if (blocks.length > 90) {
    for (let i = 90; i < blocks.length; i += 90)
      await call(`/blocks/${id}/children`, { method: 'PATCH', body: JSON.stringify({ children: blocks.slice(i, i + 90) }) });
  }
  const node: NotionNode = { id, title, kind: 'page', parent: parentId, url: page.url, edited: Date.now() };
  if (memo) {
    memo.nodes.unshift(node);
    await kvSet(MAP_KEY, JSON.stringify(memo));
  }
  return node;
}

// Finds a page by title under a parent, or creates it. Used for pages Kairos
// owns, like the finance overview.
export async function ensurePage(parentId: string, title: string, markdown = ''): Promise<NotionNode> {
  const nodes = await workspaceMap();
  const hit = nodes.find((n) => n.parent === notionId(parentId) && n.title.toLowerCase() === title.toLowerCase());
  return hit ?? createPage(parentId, title, markdown);
}

// ---------- databases (tasks mirror) ----------

export type DbSchema = { id: string; title: string; titleProp: string; dateProp?: string; doneProp?: { name: string; type: 'checkbox' | 'status'; doneValue?: string; openValue?: string } };

export async function databaseSchema(idOrUrl: string): Promise<DbSchema> {
  const id = await fullId(idOrUrl);
  const info = (await call(`/databases/${id}`)) as {
    title: RichText[];
    properties: Record<string, { type: string; status?: { options: { name: string }[]; groups?: { name: string; option_ids: string[] }[] } }>;
  };
  const props = Object.entries(info.properties);
  const titleProp = props.find(([, v]) => v.type === 'title')?.[0] ?? 'Name';
  const dateProp = props.find(([k, v]) => v.type === 'date' && /due|date|when|deadline/i.test(k))?.[0] ?? props.find(([, v]) => v.type === 'date')?.[0];
  let doneProp: DbSchema['doneProp'];
  const check = props.find(([, v]) => v.type === 'checkbox');
  const status = props.find(([, v]) => v.type === 'status');
  if (status) {
    const options = status[1].status?.options ?? [];
    const doneValue = options.find((o) => /done|complete/i.test(o.name))?.name ?? options[options.length - 1]?.name;
    const openValue = options.find((o) => /not started|to ?do|backlog/i.test(o.name))?.name ?? options[0]?.name;
    doneProp = { name: status[0], type: 'status', doneValue, openValue };
  } else if (check) doneProp = { name: check[0], type: 'checkbox' };
  return { id, title: plain(info.title), titleProp, dateProp, doneProp };
}

export async function upsertDbRow(
  schema: DbSchema,
  // Fields left undefined are not touched.
  row: { pageId?: string | null; title?: string; dueIso?: string | null; done: boolean },
): Promise<string> {
  const properties: Record<string, unknown> = {};
  if (row.title) properties[schema.titleProp] = { title: rich(row.title) };
  if (schema.dateProp && row.dueIso !== undefined)
    properties[schema.dateProp] = { date: row.dueIso ? { start: row.dueIso.slice(0, 10) } : null };
  if (schema.doneProp?.type === 'checkbox') properties[schema.doneProp.name] = { checkbox: row.done };
  if (schema.doneProp?.type === 'status') {
    const v = row.done ? schema.doneProp.doneValue : row.pageId ? schema.doneProp.openValue : undefined;
    if (v) properties[schema.doneProp.name] = { status: { name: v } };
  }
  if (row.pageId) {
    await call(`/pages/${row.pageId}`, { method: 'PATCH', body: JSON.stringify({ properties }) });
    return row.pageId;
  }
  const page = (await call('/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: schema.id }, properties }) })) as {
    id: string;
  };
  return page.id.replace(/-/g, '');
}

export type DbRow = { id: string; title: string; due: string | null; done: boolean; edited: number };

export async function queryDbRows(schema: DbSchema, limit = 50): Promise<DbRow[]> {
  const r = (await call(`/databases/${schema.id}/query`, {
    method: 'POST',
    body: JSON.stringify({ page_size: limit, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] }),
  })) as { results: { id: string; last_edited_time: string; properties: Record<string, Record<string, unknown>> }[] };
  return r.results.map((p) => {
    const props = p.properties;
    const date = schema.dateProp ? (props[schema.dateProp]?.date as { start?: string } | null) : null;
    let done = false;
    if (schema.doneProp?.type === 'checkbox') done = !!props[schema.doneProp.name]?.checkbox;
    if (schema.doneProp?.type === 'status')
      done = (props[schema.doneProp.name]?.status as { name?: string } | null)?.name === schema.doneProp.doneValue;
    return {
      id: p.id.replace(/-/g, ''),
      title: plain(props[schema.titleProp]?.title),
      due: date?.start?.slice(0, 10) ?? null,
      done,
      edited: Date.parse(p.last_edited_time) || 0,
    };
  });
}

export async function testNotion(): Promise<string> {
  const me = (await call('/users/me')) as { name?: string; bot?: { workspace_name?: string } };
  const nodes = await refreshMap();
  if (!nodes.length) {
    return `Connected to ${me.bot?.workspace_name ?? 'Notion'}, but the integration can't see any pages yet. In Notion, open your top-level page (e.g. "second brain"), tap ••• → Connections, add this integration and allow its sub-pages, then scan again.`;
  }
  return `${me.bot?.workspace_name ?? me.name ?? 'Notion'}: ${nodes.filter((n) => n.kind === 'page').length} pages and ${
    nodes.filter((n) => n.kind === 'database').length
  } databases visible`;
}
