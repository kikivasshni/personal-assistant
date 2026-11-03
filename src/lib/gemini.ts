import { getGeminiHeavyModel, getGeminiKey, getGeminiModel } from './secrets';

// Thin Gemini REST client over fetch, so there is no SDK to keep compatible
// with React Native. Supports text, images/PDFs (inlineData), JSON output
// and function calling.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  // Newer models attach signatures to parts; they must be sent back unchanged.
  thoughtSignature?: string;
  [k: string]: unknown;
};
export type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters?: {
    type: 'OBJECT';
    properties: Record<string, { type: string; description?: string; enum?: string[]; items?: unknown }>;
    required?: string[];
  };
};

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

type GenerateResponse = {
  candidates?: { content?: { parts?: GeminiPart[]; role?: string }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

export type GenerateOptions = {
  system?: string;
  tools?: FunctionDeclaration[];
  json?: boolean;
  heavy?: boolean; // use the bigger model (briefings, PDFs, reviews)
  temperature?: number;
  signal?: AbortSignal;
};

export async function generateRaw(contents: GeminiContent[], opts: GenerateOptions = {}): Promise<GeminiPart[]> {
  const key = await getGeminiKey();
  if (!key) throw new GeminiError('Add your Gemini API key in Settings first.');
  const model = opts.heavy ? await getGeminiHeavyModel() : await getGeminiModel();

  const body: Record<string, unknown> = { contents };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (opts.tools?.length) body.tools = [{ functionDeclarations: opts.tools }];
  const generationConfig: Record<string, unknown> = {};
  if (opts.json) generationConfig.responseMimeType = 'application/json';
  if (opts.temperature != null) generationConfig.temperature = opts.temperature;
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

  const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  const json = (await res.json().catch(() => ({}))) as GenerateResponse;

  if (!res.ok) {
    const detail = json.error?.message ?? res.statusText;
    if (res.status === 429) throw new GeminiError(`Gemini's free-tier limit was hit. Try again in a minute. (${detail})`, 429);
    if (res.status === 404) throw new GeminiError(`Model "${model}" wasn't found. Check the model name in Settings.`, 404);
    throw new GeminiError(`Gemini ${res.status}: ${detail}`, res.status);
  }
  if (json.promptFeedback?.blockReason) throw new GeminiError(`Gemini blocked this: ${json.promptFeedback.blockReason}`);
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  if (!parts.length) throw new GeminiError('Gemini returned an empty reply.');
  return parts;
}

export function textOf(parts: GeminiPart[]): string {
  return parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

export async function generateText(contents: GeminiContent[] | string, opts: GenerateOptions = {}): Promise<string> {
  const c = typeof contents === 'string' ? [userText(contents)] : contents;
  return textOf(await generateRaw(c, opts));
}

export async function generateJson<T>(contents: GeminiContent[] | string, opts: GenerateOptions = {}): Promise<T> {
  const raw = await generateText(contents, { ...opts, json: true });
  return parseJsonLoose<T>(raw);
}

export function parseJsonLoose<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.search(/[\[{]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new GeminiError('Gemini replied in a format I could not read. Try again.');
  }
}

export function userText(text: string): GeminiContent {
  return { role: 'user', parts: [{ text }] };
}

export function userWithFile(text: string, mimeType: string, base64: string): GeminiContent {
  return { role: 'user', parts: [{ inlineData: { mimeType, data: base64 } }, { text }] };
}
