import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Card, Section } from '@/components/ui';
import { cachedHabits, dayOf, HabitState, loadHabits, setHabit, streak } from '@/lib/habits';
import { useLive } from '@/lib/live';
import { colors, fonts, palette, radius, space, type } from '@/theme';

// Today's habits from the Notion habit tracker. Tap to tick; it writes to
// Notion. Shows nothing until a habit tracker is shared with the integration.
export function HabitsCard() {
  const [state, setState] = useState<HabitState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Cache first so the card appears instantly, then refresh from Notion.
    const cached = await cachedHabits();
    if (cached) setState(cached);
    try {
      setState(await loadHabits());
      setErr(null);
    } catch (e) {
      if (!cached) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);
  useLive(load, { tables: ['kv'], focus: false });

  if (!loaded && !state) return null;
  if (!state) {
    if (!err) return null;
    return (
      <Section title="Habits">
        <Card>
          <Text style={[type.small, { color: colors.danger }]}>{err}</Text>
        </Card>
      </Section>
    );
  }
  if (!state.habits.length) return null;

  const today = dayOf(state);
  const doneCount = state.habits.filter((h) => today?.done[h]).length;

  const toggle = async (h: string) => {
    const next = !today?.done[h];
    if (next) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      setState(await setHabit(h, next));
    } catch (e) {
      Alert.alert("Couldn't update Notion", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Section
      title={`Habits · ${doneCount}/${state.habits.length}`}
      action={
        <Pressable onPress={() => router.push('/habits')} hitSlop={10}>
          <Text style={styles.link}>History</Text>
        </Pressable>
      }
    >
      <Card style={{ gap: 0, paddingVertical: space.xs }}>
        {state.habits.map((h, i) => {
          const done = !!today?.done[h];
          const s = streak(state, h);
          return (
            <Pressable key={h} onPress={() => toggle(h)} style={[styles.item, i > 0 && styles.border]}>
              <View style={[styles.check, done && styles.checked]}>{done && <Ionicons name="checkmark" size={16} color="#fff" />}</View>
              <Text style={[type.body, { flex: 1 }, done && styles.doneText]}>{h}</Text>
              {s >= 2 && <Text style={styles.streak}>🔥 {s}</Text>}
            </Pressable>
          );
        })}
        {!loaded && <ActivityIndicator color={colors.accent} style={{ paddingVertical: space.sm }} />}
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  link: { fontFamily: fonts.bodyHeavy, color: colors.accent, fontSize: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 11 },
  border: { borderTopWidth: 1, borderTopColor: colors.border },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: palette.lilacDeep, borderColor: palette.lilacDeep },
  doneText: { color: colors.textMuted },
  streak: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.textSoft, backgroundColor: palette.butter, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
