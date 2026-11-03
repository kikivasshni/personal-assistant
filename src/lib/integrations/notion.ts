import { getSecret } from '../secrets';

// Notion: internal integration token. The app appends to your Journal
// database and creates school-note pages under a parent page you choose.
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

async function call(path: string, init: RequestInit = {}) {
  const token = await getSecret('notionToken');
  if (!token) throw new Error('Add your Notion integration token in Settings.');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(json as { message?: string }).message ?? ''}`);
  return json as Record<string, unknown>;
}

// Accept either a raw ID or a full Notion URL.
export function notionId(input: string): string {
  const m = input.replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return m ? m[0] : input.trim();
}

type Block = Record<string, unknown>;
const rich = (text: string) => [{ type: 'text', text: { content: text.slice(0, 1900) } }];

// Small Markdown-to-Notion converter: headings, bullets, numbers, quotes, paragraphs.
export function markdownToBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const plain = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
    let m: RegExpMatchArray | null;
    if ((m = plain.match(/^###\s+(.*)/))) blocks.push({ type: 'heading_3', heading_3: { rich_text: rich(m[1]) } });
    else if ((m = plain.match(/^##\s+(.*)/))) blocks.push({ type: 'heading_2', heading_2: { rich_text: rich(m[1]) } });
    else if ((m = plain.match(/^#\s+(.*)/))) blocks.push({ type: 'heading_1', heading_1: { rich_text: rich(m[1]) } });
    else if ((m = plain.match(/^\s*[-*]\s+(.*)/)))
      blocks.push({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(m[1]) } });
    else if ((m = plain.match(/^\s*\d+[.)]\s+(.*)/)))
      blocks.push({ type: 'numbered_list_item', numbered_list_item: { rich_text: rich(m[1]) } });
    else if ((m = plain.match(/^>\s+(.*)/))) blocks.push({ type: 'quote', quote: { rich_text: rich(m[1]) } });
    else blocks.push({ type: 'paragraph', paragraph: { rich_text: rich(plain) } });
  }
  return blocks.slice(0, 100);
}

async function titleProperty(databaseId: string): Promise<string> {
  const dbInfo = (await call(`/databases/${databaseId}`)) as { properties: Record<string, { type: string }> };
  const entry = Object.entries(dbInfo.properties).find(([, v]) => v.type === 'title');
  return entry ? entry[0] : 'Name';
}

export async function addJournalEntry(title: string, markdown: string): Promise<string> {
  const raw = await getSecret('notionJournalDb');
  if (!raw) throw new Error('Add your Notion Journal database link in Settings.');
  const databaseId = notionId(raw);
  const prop = await titleProperty(databaseId);
  const page = (await call('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: { [prop]: { title: rich(title) } },
      children: markdownToBlocks(markdown),
    }),
  })) as { url: string };
  return page.url;
}

export async function addNotesPage(title: string, markdown: string): Promise<string> {
  const raw = await getSecret('notionNotesPage');
  if (!raw) throw new Error('Add the Notion page for school notes in Settings.');
  const page = (await call('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { page_id: notionId(raw) },
      properties: { title: { title: rich(title) } },
      children: markdownToBlocks(markdown),
    }),
  })) as { url: string };
  return page.url;
}

export async function testNotion(): Promise<string> {
  const me = (await call('/users/me')) as { name?: string; bot?: { workspace_name?: string } };
  return me.bot?.workspace_name ?? me.name ?? 'connected';
}
