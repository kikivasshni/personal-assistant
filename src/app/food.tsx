import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useLive } from '@/lib/live';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Empty, Screen, Section, Stat } from '@/components/ui';
import { Food } from '@/lib/db';
import { analyseMeal, deleteMeal, MealEstimate, mealsToday, recentMeals, saveMeal, totals } from '@/lib/food';
import { colors, fonts, palette, radius, space, type } from '@/theme';

const GL_TINT = { low: palette.mint, medium: palette.butter, high: palette.rose } as const;

export default function FoodScreen() {
  const [today, setToday] = useState<Food[]>([]);
  const [history, setHistory] = useState<Food[]>([]);
  const [photo, setPhoto] = useState<{ uri: string; base64: string; mime: string } | null>(null);
  const [hint, setHint] = useState('');
  const [estimate, setEstimate] = useState<MealEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setToday(await mealsToday());
    setHistory(await recentMeals(20));
  }, []);
  useLive(load);

  const pick = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], base64: true, quality: 0.5 };
    if (camera) {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return;
    }
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]?.base64) return;
    const a = r.assets[0];
    setPhoto({ uri: a.uri, base64: a.base64!, mime: a.mimeType ?? 'image/jpeg' });
    setEstimate(null);
    setErr(null);
  };

  const analyse = async () => {
    if (!photo) return;
    setBusy(true);
    setErr(null);
    try {
      setEstimate(await analyseMeal(photo.base64, photo.mime, hint));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!estimate) return;
    await saveMeal(estimate, photo?.uri);
    setPhoto(null);
    setEstimate(null);
    setHint('');
    load();
  };

  const t = totals(today);

  return (
    <Screen>
      <View style={styles.stats}>
        <Stat label="kcal" value={String(t.kcal)} tint={palette.peach} />
        <Stat label="protein" value={`${t.protein}g`} tint={palette.rose} />
        <Stat label="carbs" value={`${t.carbs}g`} tint={palette.butter} />
        <Stat label="fibre" value={`${t.fibre}g`} tint={palette.mint} />
      </View>

      <Card tint={palette.rose}>
        {photo ? (
          <>
            <Image source={{ uri: photo.uri }} style={styles.photo} />
            <TextInput
              style={styles.input}
              value={hint}
              onChangeText={setHint}
              placeholder="Anything to add? e.g. half portion of rice"
              placeholderTextColor={colors.textMuted}
            />
            {!estimate && <Button title="Estimate macros" icon="sparkles" onPress={analyse} loading={busy} />}
          </>
        ) : (
          <>
            <Text style={type.title}>What are you eating?</Text>
            <Text style={type.bodySoft}>Snap it to estimate calories, protein, carbs and how it sits with your insulin.</Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Camera" icon="camera-outline" onPress={() => pick(true)} style={{ flex: 1 }} />
              <Button title="Gallery" variant="soft" onPress={() => pick(false)} style={{ flex: 1 }} />
            </View>
          </>
        )}
        {err && <Text style={[type.small, { color: colors.danger }]}>{err}</Text>}
        {estimate && (
          <View style={{ gap: space.sm }}>
            <Text style={type.title}>{estimate.description}</Text>
            <Text style={type.small}>{estimate.items.map((i) => `${i.name} (${i.portion})`).join(' · ')}</Text>
            <View style={styles.stats}>
              <Stat label="kcal" value={String(Math.round(estimate.kcal))} tint="#FFFFFFAA" />
              <Stat label="protein" value={`${Math.round(estimate.protein)}g`} tint="#FFFFFFAA" />
              <Stat label="carbs" value={`${Math.round(estimate.carbs)}g`} tint="#FFFFFFAA" />
              <Stat label="fat" value={`${Math.round(estimate.fat)}g`} tint="#FFFFFFAA" />
            </View>
            <View style={[styles.gl, { backgroundColor: GL_TINT[estimate.gl] ?? palette.butter }]}>
              <Text style={styles.glText}>{estimate.gl} glycaemic load</Text>
            </View>
            <Text style={type.bodySoft}>{estimate.note}</Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Log it" onPress={save} style={{ flex: 1 }} />
              <Button title="Discard" variant="ghost" onPress={() => (setEstimate(null), setPhoto(null))} />
            </View>
          </View>
        )}
      </Card>

      <Button
        title="Ask the Health coach"
        variant="soft"
        icon="heart-outline"
        onPress={() => router.push(`/chat/health.food?prompt=${encodeURIComponent('Rate what I ate today for my PCOS goals and tell me what to eat next.')}`)}
      />

      <Section title="Recent meals">
        {history.length === 0 ? (
          <Card>
            <Empty icon="nutrition-outline" title="No meals yet" body="Your first photo starts the log." />
          </Card>
        ) : (
          history.map((m) => (
            <Pressable
              key={m.id}
              onLongPress={() =>
                Alert.alert('Delete this meal?', m.description, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => deleteMeal(m.id).then(load) },
                ])
              }
            >
              <Card style={styles.meal}>
                {m.photo_uri ? <Image source={{ uri: m.photo_uri }} style={styles.thumb} /> : <View style={styles.thumbEmpty}><Ionicons name="restaurant-outline" size={22} color={palette.roseDeep} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={type.heading}>{m.description}</Text>
                  <Text style={type.small}>
                    {new Date(m.created_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} ·{' '}
                    {Math.round(m.kcal ?? 0)} kcal · {Math.round(m.protein ?? 0)}g P · {Math.round(m.carbs ?? 0)}g C
                  </Text>
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space.sm },
  photo: { width: '100%', aspectRatio: 1.2, borderRadius: radius.md },
  input: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    backgroundColor: '#FFFFFFCC',
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  gl: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  glText: { fontFamily: fonts.bodyHeavy, fontSize: 13, color: colors.text, textTransform: 'capitalize' },
  meal: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  thumb: { width: 52, height: 52, borderRadius: 14 },
  thumbEmpty: { width: 52, height: 52, borderRadius: 14, backgroundColor: palette.rose, alignItems: 'center', justifyContent: 'center' },
});
