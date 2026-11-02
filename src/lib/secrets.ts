import * as SecureStore from 'expo-secure-store';

// Stored in the Android Keystore / iOS Keychain, never in the app bundle or git.
const KEYS = {
  geminiApiKey: 'gemini_api_key',
  geminiModel: 'gemini_model',
} as const;

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

export async function getGeminiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.geminiApiKey);
}

export async function setGeminiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) await SecureStore.setItemAsync(KEYS.geminiApiKey, trimmed);
  else await SecureStore.deleteItemAsync(KEYS.geminiApiKey);
}

export async function getGeminiModel(): Promise<string> {
  return (await SecureStore.getItemAsync(KEYS.geminiModel)) || DEFAULT_MODEL;
}

export async function setGeminiModel(value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) await SecureStore.setItemAsync(KEYS.geminiModel, trimmed);
  else await SecureStore.deleteItemAsync(KEYS.geminiModel);
}
