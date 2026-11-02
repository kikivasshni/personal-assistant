import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { ask } from '@/lib/gemini';
import { getGeminiKey, getGeminiModel } from '@/lib/secrets';
import { colors, radius, space, type } from '@/theme';

// Phase 0 smoke test: one prompt, one Gemini reply.
const SYSTEM =
  'You are The Oracle, a sharp, warm personal assistant and coach. Keep replies under 120 words.';

export default function Home() {
  const [prompt, setPrompt] = useState('Give me one line of motivation for studying for AWS SAP tonight.');
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [model, setModel] = useState('');

  useFocusEffect(
    useCallback(() => {
      getGeminiKey().then((k) => setHasKey(!!k));
      getGeminiModel().then(setModel);
    }, []),
  );

  const onAsk = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setReply(null);
    const started = Date.now();
    try {
      const text = await ask(prompt.trim(), SYSTEM);
      setReply(`${text}\n\n(${model}, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={type.title}>Phase 0 check</Text>
        <Text style={[type.body, styles.muted]}>
          If this returns a reply, the app can reach Gemini from your phone.
        </Text>

        {hasKey === false && (
          <Link href="/settings" asChild>
            <Pressable style={styles.banner}>
              <Text style={styles.bannerText}>No Gemini API key yet. Tap to add one.</Text>
            </Pressable>
          </Link>
        )}

        <Text style={[type.label, styles.gap]}>PROMPT</Text>
        <TextInput
          style={styles.input}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          placeholder="Ask The Oracle something"
          placeholderTextColor={colors.textMuted}
        />

        <Pressable
          onPress={onAsk}
          disabled={loading || !hasKey}
          style={({ pressed }) => [styles.button, (pressed || loading || !hasKey) && styles.buttonDim]}
        >
          {loading ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.buttonText}>Ask Gemini</Text>
          )}
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}
        {reply && (
          <View style={styles.card}>
            <Text style={type.body}>{reply}</Text>
          </View>
        )}

        <Link href="/settings" style={styles.link}>
          Settings
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: space.lg, gap: space.sm },
  muted: { color: colors.textMuted },
  gap: { marginTop: space.lg },
  banner: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  bannerText: { ...type.body, color: colors.accent },
  input: {
    ...type.body,
    minHeight: 96,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    textAlignVertical: 'top',
  },
  button: {
    marginTop: space.sm,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDim: { opacity: 0.6 },
  buttonText: { fontSize: 16, fontWeight: '700', color: colors.accentText },
  error: { ...type.body, color: colors.danger, marginTop: space.md },
  card: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  link: { ...type.body, color: colors.accent, marginTop: space.xl, textAlign: 'center' },
});
