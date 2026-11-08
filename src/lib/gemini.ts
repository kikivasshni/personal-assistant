import { fetch as streamingFetch } from 'expo/fetch';
import { getGeminiHeavyModel, getGeminiKey, getGeminiModel } from './secrets';

// Thin Gemini REST client over fetch, so there is no SDK to keep compatible
// with React Native. Supports text, images/PDFs (inlineData), JSON output,
// function calling and streaming.
//
// Reliability: 503 "model overloaded" and other 5xx errors are retried with
// backoff, then the call falls back to your other configured model. 429
// (quota) skips straight to the fallback model.
// Speed: chat runs with low thinking effort and streams tokens as they arrive.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiPart = {
  text?: string;
  thought?: boolean;
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
  error?: { message?: string; code?: number };
};

export type GenerateOptions = {
  system?: string;
  tools?: FunctionDeclaration[];
  json?: boolean;
  heavy?: boolean; // use the heavy model (briefings, PDFs, photos)
  temperature?: number;
  signal?: AbortSignal;
  // 'low' is fast and fine for chat. 'default' lets the model think as long
  // as it likes (statement parsing, notes).
  thinking?: 'low' | 'default';
  // Streaming: called with the full reply text so far as tokens arrive.
  onText?: (textSoFar: string) => void;
};

// Models that rejected thinkingConfig; we stop sending it to them.
const noThinking = new Set<string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryable(status?: number) {
  return status == null || status >= 500 || status === 408;
}

async function modelChain(heavy?: boolean): Promise<string[]> {
  const [main, other] = heavy
    ? [await getGeminiHeavyModel(), await getGeminiModel()]
    : [await getGeminiModel(), await getGeminiHeavyModel()];
  return main === other ? [main] : [main, other];
}

export async function generateRaw(contents: GeminiContent[], opts: GenerateOptions = {}): Promise<GeminiPart[]> {
  const key = await getGeminiKey();
  if (!key) throw new GeminiError('Add your Gemini API key in Settings first.');
  const chain = await modelChain(opts.heavy);
  const thinking = opts.thinking ?? (opts.heavy ? 'default' : 'low');
  let last: GeminiError | null = null;

  for (const model of chain) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let streamed = false;
      try {
        return await callOnce(model, key, contents, opts, thinking, () => (streamed = true));
      } catch (e) {
        const err = e instanceof GeminiError ? e : new GeminiError(e instanceof Error ? e.message : String(e));
        if (opts.signal?.aborted) throw err;
        last = err;
        // Once text has reached the screen, a retry would duplicate it.
        if (streamed) throw err;
        if (err.status === 400 && /thinking/i.test(err.message) && !noThinking.has(model)) {
          noThinking.add(model);
          attempt--;
          continue;
        }
        if (err.status === 429) break; // quota: go to the next model
        if (!retryable(err.status)) throw err;
        if (attempt < 2) await sleep(600 * 2 ** attempt + Math.random() * 400);
      }
    }
  }
  if (last?.status === 503)
    throw new GeminiError(
      `Gemini is overloaded right now (503) and the retry and backup model didn't get through either (${chain.join(', ')}). Try again in a minute.`,
      503,
    );
  if (last?.status === 429)
    throw new GeminiError(`You've hit Gemini's rate limit on ${chain.join(' and ')}. Wait a minute, or enable billing in AI Studio for higher limits.`, 429);
  throw last ?? new GeminiError('Gemini did not respond.');
}

async function callOnce(
  model: string,
  key: string,
  contents: GeminiContent[],
  opts: GenerateOptions,
  thinking: 'low' | 'default',
  markStreamed: () => void,
): Promise<GeminiPart[]> {
  const body: Record<string, unknown> = { contents };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (opts.tools?.length) body.tools = [{ functionDeclarations: opts.tools }];
  const generationConfig: Record<string, unknown> = {};
  if (opts.json) generationConfig.responseMimeType = 'application/json';
  if (opts.temperature != null) generationConfig.temperature = opts.temperature;
  if (thinking === 'low' && !noThinking.has(model)) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

  // Our own timeout, chained to the caller's signal.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.heavy ? 180_000 : 90_000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);

  try {
    const stream = !!opts.onText;
    const url = `${BASE}/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    };

    if (!stream) {
      const res = await fetch(url, init);
      const json = (await res.json().catch(() => ({}))) as GenerateResponse;
      if (!res.ok) throw httpError(res.status, json, model);
      return partsOf(json);
    }

    const res = await streamingFetch(url, init);
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as GenerateResponse;
      throw httpError(res.status, json, model);
    }
    const parts: GeminiPart[] = [];
    let text = '';
    let buffer = '';
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        let chunk: GenerateResponse;
        try {
          chunk = JSON.parse(line.slice(5));
        } catch {
          continue;
        }
        if (chunk.error) throw new GeminiError(`Gemini: ${chunk.error.message ?? 'stream error'}`, chunk.error.code);
        if (chunk.promptFeedback?.blockReason) throw new GeminiError(`Gemini blocked this: ${chunk.promptFeedback.blockReason}`);
        for (const p of chunk.candidates?.[0]?.content?.parts ?? []) {
          parts.push(p);
          if (p.text && !p.thought) {
            text += p.text;
            markStreamed();
            opts.onText?.(text);
          }
        }
      }
    }
    if (!parts.length) throw new GeminiError('Gemini returned an empty reply.', 503);
    return parts;
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if (ctrl.signal.aborted && !opts.signal?.aborted) throw new GeminiError('Gemini took too long to answer.', 408);
    throw new GeminiError(`Couldn't reach Gemini: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

function httpError(status: number, json: GenerateResponse, model: string) {
  const detail = json.error?.message ?? '';
  if (status === 404) return new GeminiError(`Model "${model}" wasn't found. Check the model name in Settings.`, 404);
  return new GeminiError(`Gemini ${status} (${model}): ${detail}`, status);
}

function partsOf(json: GenerateResponse): GeminiPart[] {
  if (json.promptFeedback?.blockReason) throw new GeminiError(`Gemini blocked this: ${json.promptFeedback.blockReason}`);
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  // An empty candidate is usually a transient server hiccup, so let it retry.
  if (!parts.length) throw new GeminiError('Gemini returned an empty reply.', 503);
  return parts;
}

// Models sometimes trail off into runs of blank lines, whitespace or invisible
// characters (zero-width spaces etc.). Rendered literally, each one is a line
// of nothing, so a reply can end in a screen-tall empty bubble. Strip the
// invisibles, collapse blank runs to one gap, and trim the ends.
export function cleanReply(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[​-‍⁠﻿­ㅤᅟᅠ]/g, '')
    .replace(/[ \t ]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function textOf(parts: GeminiPart[]): string {
  return parts
    .filter((p) => !p.thought)
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
