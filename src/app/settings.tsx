import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { DEFAULT_MODEL, getGeminiKey, getGeminiModel, setGeminiKey, setGeminiModel } from '@/lib/secrets';
import { colors, radius, space, type } from '@/theme';

export default function Settings() {
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [hadKey, setHadKey] = useState(false);

  useEffect(() => {
    getGeminiKey().then((k) => setHadKey(!!k));
    getGeminiModel().then(setModel);
  }, []);

  const onSave = async () => {
    // Leaving the key blank keeps the saved one; type a new key to replace it.
    if (key.trim()) await setGeminiKey(key);
    await setGeminiModel(model);
    Alert.alert('Saved', 'Stored securely on this phone.');
    router.back();
  };

  const onClear = async () => {
    await setGeminiKey('');
    setHadKey(false);
    setKey('');
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={type.label}>GEMINI API KEY</Text>
      <TextInput
        style={styles.input}
        value={key}
        onChangeText={setKey}
        placeholder={hadKey ? 'Saved. Type a new key to replace it' : 'Paste your key from AI Studio'}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      <Text style={[type.label, styles.gap]}>MODEL</Text>
      <TextInput
        style={styles.input}
        value={model}
        onChangeText={setModel}
        placeholder={DEFAULT_MODEL}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Pressable style={styles.button} onPress={onSave}>
        <Text style={styles.buttonText}>Save</Text>
      </Pressable>
      {hadKey && (
        <Pressable onPress={onClear}>
          <Text style={styles.clear}>Remove saved key</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.sm, backgroundColor: colors.bg, flexGrow: 1 },
  gap: { marginTop: space.lg },
  input: {
    ...type.body,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: {
    marginTop: space.lg,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '700', color: colors.accentText },
  clear: { ...type.body, color: colors.danger, textAlign: 'center', marginTop: space.md },
});
