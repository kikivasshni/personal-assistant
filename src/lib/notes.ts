import { db, Note } from './db';
import { generateJson, GeminiContent, GeminiPart } from './gemini';
import { addNotesPage } from './integrations/notion';

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

export async function saveNotes(n: StudyNotes, pushToNotion: boolean): Promise<Note> {
  const body = notesMarkdown(n);
  let url: string | null = null;
  if (pushToNotion) url = await addNotesPage(`${n.module ? n.module + ' · ' : ''}${n.title}`, body);
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
