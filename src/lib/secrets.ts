import * as SecureStore from 'expo-secure-store';

// Keys, tokens and IDs live in the Android Keystore / iOS Keychain,
// never in the app bundle or in git.

export const SECRET_KEYS = {
  geminiApiKey: 'gemini_api_key',
  geminiModel: 'gemini_model',
  geminiHeavyModel: 'gemini_heavy_model',
  youtubeApiKey: 'youtube_api_key',
  msClientId: 'ms_client_id',
  msTokens: 'ms_tokens',
  googleClientId: 'google_client_id',
  googleTokens: 'google_tokens',
  notionToken: 'notion_token',
} as const;

export type SecretKey = keyof typeof SECRET_KEYS;

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_HEAVY_MODEL = 'gemini-3.8-flash';

export async function getSecret(key: SecretKey): Promise<string | null> {
  return SecureStore.getItemAsync(SECRET_KEYS[key]);
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) await SecureStore.setItemAsync(SECRET_KEYS[key], trimmed);
  else await SecureStore.deleteItemAsync(SECRET_KEYS[key]);
}

export async function getJsonSecret<T>(key: SecretKey): Promise<T | null> {
  const raw = await getSecret(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJsonSecret(key: SecretKey, value: unknown | null): Promise<void> {
  await setSecret(key, value == null ? '' : JSON.stringify(value));
}

export const getGeminiKey = () => getSecret('geminiApiKey');
export const getGeminiModel = async () => (await getSecret('geminiModel')) || DEFAULT_MODEL;
export const getGeminiHeavyModel = async () => (await getSecret('geminiHeavyModel')) || DEFAULT_HEAVY_MODEL;
