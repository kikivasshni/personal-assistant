import { getGeminiKey, getGeminiModel } from './secrets';

// Thin wrapper over the Gemini REST API using fetch, so there is no SDK to
// keep compatible with React Native. Phase 1 adds system prompts per coach,
// chat history and function calling on top of this.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiPart = { text?: string };
export type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

export class GeminiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GeminiError';
  }
}

type GenerateResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

export async function generate(
  contents: GeminiContent[],
  opts: { systemInstruction?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const key = await getGeminiKey();
  if (!key) throw new GeminiError('No Gemini API key yet. Add one in Settings.');
  const model = await getGeminiModel();

  const body: Record<string, unknown> = { contents };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  const json = (await res.json().catch(() => ({}))) as GenerateResponse;

  if (!res.ok) {
    const detail = json.error?.message ?? res.statusText;
    if (res.status === 429) {
      throw new GeminiError(`Rate limited by the free tier (429). ${detail}`, 429);
    }
    throw new GeminiError(`Gemini ${res.status}: ${detail}`, res.status);
  }

  if (json.promptFeedback?.blockReason) {
    throw new GeminiError(`Blocked by Gemini: ${json.promptFeedback.blockReason}`);
  }

  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) throw new GeminiError('Gemini returned an empty reply.');
  return text;
}

export function ask(prompt: string, systemInstruction?: string): Promise<string> {
  return generate([{ role: 'user', parts: [{ text: prompt }] }], { systemInstruction });
}
