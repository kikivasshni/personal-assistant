import { db, Note } from './db';
import { generateJson, GeminiContent, GeminiPart } from './gemini';
import { appendToPage, createPage, outline, workspaceMap } from './integrations/notion';
import { hasSecondBrain, saveNote } from './integrations/secondBrain';

export type StudyNotes = {
  title: string;
  module: string;
  summary: string;
  notes_md: string;
  key_terms: { term: string; meaning: string }[];
  exam_questions: string[];
  flashcards: { q: string; a: string }[];
};

export type Source = { mimeType: string; base64: string };

// Turns lecture slides, PDFs or photos into structured study notes.
export async function makeNotes(sources: Source[], moduleHint: string, extra: string): Promise<StudyNotes> {
  const parts: GeminiPart[] = sources.map((s) => ({ inlineData: { mimeType: s.mimeType, data: s.base64 } }));
  parts.push({
    text: `Turn this lecture material into excellent study notes for kirthi, a Year 4 Software Engineering student${moduleHint ? ` (module: ${moduleHint})` : ''}. ${extra}
Be accurate to the material; don't invent content. Use clear Markdown in notes_md (## sections, bullets, short examples).
Return JSON: {"title": "", "module": "", "summary": "3-4 sentences", "notes_md": "", "key_terms": [{"term": "", "meaning": ""}], "exam_questions": ["5 likely exam questions"], "flashcards": [{"q": "", "a": ""}]}  (8-15 flashcards)`,
  });
  const contents: GeminiContent[] = [{ role: 'user', parts }];
  return generateJson<StudyNotes>(contents, { heavy: true, temperature: 0.3 });
}

export function notesMarkdown(n: StudyNotes): string {
  return [
    `> ${n.summary}`,
    '',
    n.notes_md,
    '',
    '## Key terms',
    ...n.key_terms.map((k) => `- **${k.term}**: ${k.meaning}`),
    '',
    '## Likely exam questions',
    ...n.exam_questions.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n');
}

// Lets Gemini decide where new notes belong in your Notion, based on the
// workspace outline and how your existing module pages are organised.
export async function placeInNotion(title: string, markdown: string, hint: string, notebook?: string): Promise<string> {
  // Second brain: a note row in the module's notebook.
  if (await hasSecondBrain()) return (await saveNote({ notebook: notebook || 'SMU modules', title, markdown, area: 'coding' })).url;
  const nodes = await workspaceMap();
  if (!nodes.length) throw new Error('Connect Notion under You → Notion first.');
  const pick = await generateJson<{ mode: 'create' | 'append'; id: string; title: string }>(
    `kirthi keeps study notes in Notion. Decide where these new notes go.
Notes: "${title}" (${hint}).
Workspace outline (title (id)):
${outline(nodes, 200)}
Rules: put them under the page for their module or course if one exists (create a new child page there, titled like its siblings). If no module page exists, create the page under their main school / notes page. Use append only if a page for exactly this lecture already exists.
Return JSON: {"mode": "create|append", "id": "<8-char id of the parent (create) or page (append)>", "title": "<page title matching sibling naming>"}`,
    { temperature: 0 },
  );
  if (pick.mode === 'append') return appendToPage(pick.id, markdown);
  return (await createPage(pick.id, pick.title || title, markdown)).url;
}

export async function saveNotes(n: StudyNotes, pushToNotion: boolean): Promise<Note> {
  const body = notesMarkdown(n);
  let url: string | null = null;
  if (pushToNotion) url = await placeInNotion(n.title, body, n.module ? `module ${n.module}` : 'lecture notes', n.module || undefined);
  const d = await db();
  const r = await d.runAsync(
    'INSERT INTO notes(module, title, body, flashcards, notion_url, created_at) VALUES(?, ?, ?, ?, ?, ?)',
    n.module || null,
    n.title,
    body,
    JSON.stringify(n.flashcards ?? []),
    url,
    Date.now(),
  );
  return (await d.getFirstAsync<Note>('SELECT * FROM notes WHERE id = ?', r.lastInsertRowId))!;
}

export async function allNotes(): Promise<Note[]> {
  return (await db()).getAllAsync<Note>('SELECT * FROM notes ORDER BY created_at DESC');
}

export async function getNote(id: number): Promise<Note | null> {
  return (await db()).getFirstAsync<Note>('SELECT * FROM notes WHERE id = ?', id);
}

export async function deleteNote(id: number) {
  await (await db()).runAsync('DELETE FROM notes WHERE id = ?', id);
}
