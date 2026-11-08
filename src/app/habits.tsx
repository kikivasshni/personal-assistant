import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Empty, Screen, Section } from '@/components/ui';
import { addDays, dayKey } from '@/lib/db';
import { cachedHabits, dayOf, HabitState, loadHabits, setHabit, streak } from '@/lib/habits';
import { useLive } from '@/lib/live';
import { colors, fonts, palette, radius, space, type } from '@/theme';

const DAYS = 14;

export default function Habits() {
  const [state, setState] = useState<HabitState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    const cached = await cachedHabits();
    if (cached) setState(cached);
    try {
      setState(await loadHabits(force ? 0 : 60_000));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useLive(load, { tables: ['kv'] });

  const refresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const days = Array.from({ length: DAYS }, (_, i) => dayKey(addDays(new Date(), i - DAYS + 1)));

  const toggle = async (h: string, day: string) => {
    if (!state) return;
    try {
      setState(await setHabit(h, !dayOf(state, day)?.done[h], day));
    } catch (e) {
      Alert.alert("Couldn't update Notion", e instanceof Error ? e.message : String(e));
    }
  };

  if (!state) {
    return (
      <Screen onRefresh={refresh} refreshing={refreshing}>
        <Empty
          icon="checkmark-done-outline"
          title="No habit tracker yet"
          body={err ?? 'Share your "habit tracker" database with the Kairos integration in Notion (••• → Connections), then scan Notion again in You → Notion.'}
        />
      </Screen>
    );
  }

  // Completion rate per day across all habits, for the strip at the top.
  const rate = (day: string) => {
    const d = dayOf(state, day);
    return d ? state.habits.filter((h) => d.done[h]).length / Math.max(1, state.habits.length) : 0;
  };

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Section title="Last 14 days">
        <Card style={{ gap: space.sm }}>
          <View style={styles.row}>
            <View style={styles.label} />
            {days.map((d) => (
              <Text key={d} style={[styles.dayHead, d === dayKey() && { color: colors.accent }]}>
                {new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'narrow' })}
              </Text>
            ))}
          </View>
          <View style={styles.row}>
            <Text style={[type.small, styles.label]}>all habits</Text>
            {days.map((d) => (
              <View key={d} style={styles.cell}>
                <View style={[styles.dot, { backgroundColor: palette.lilacDeep, opacity: 0.15 + 0.85 * rate(d) }]} />
              </View>
            ))}
          </View>
          {state.habits.map((h) => (
            <View key={h} style={styles.row}>
              <Text style={[type.small, styles.label, { color: colors.text }]} numberOfLines={2}>
                {h}
              </Text>
              {days.map((d) => {
                const done = !!dayOf(state, d)?.done[h];
                return (
                  <Pressable key={d} onPress={() => toggle(h, d)} hitSlop={2} style={styles.cell}>
                    <View style={[styles.box, done && styles.boxDone]}>{done && <Ionicons name="checkmark" size={11} color="#fff" />}</View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <Text style={type.small}>Tap a square to tick or untick that day. Changes save to Notion.</Text>
        </Card>
      </Section>

      <Section title="Streaks">
        <Card style={{ gap: 0, paddingVertical: space.xs }}>
          {state.habits.map((h, i) => {
            const s = streak(state, h);
            const last14 = days.filter((d) => dayOf(state, d)?.done[h]).length;
            return (
              <View key={h} style={[styles.streakRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <Text style={[type.body, { flex: 1 }]}>{h}</Text>
                <Text style={type.small}>{last14}/14</Text>
                <Text style={styles.streak}>{s ? `🔥 ${s}` : '–'}</Text>
              </View>
            );
          })}
        </Card>
      </Section>

      <Button
        title="Open tracker in Notion"
        variant="ghost"
        icon="open-outline"
        onPress={() => Linking.openURL(`https://www.notion.so/${state.dbId}`)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { width: 96, paddingRight: 6 },
  dayHead: { flex: 1, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  box: { width: 17, height: 17, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  boxDone: { backgroundColor: palette.lilacDeep, borderColor: palette.lilacDeep },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 11 },
  streak: { width: 48, textAlign: 'right', fontFamily: fonts.bodyBold, fontSize: 13, color: colors.textSoft, borderRadius: radius.pill },
});
