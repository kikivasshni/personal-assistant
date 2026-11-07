import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Bar, Button, Card, Screen, Section, Sheet } from '@/components/ui';
import { Icon3D } from '@/components/Icon3D';
import { dayKey, Mood, parseDayKey } from '@/lib/db';
import { clearMood, MOODS, moodOf, moodsForMonth, setMood } from '@/lib/moods';
import { colors, fonts, radius, space, type } from '@/theme';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function MoodCalendar() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [moods, setMoods] = useState<Record<string, Mood>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => setMoods(await moodsForMonth(cursor.y, cursor.m)), [cursor]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const shift = (n: number) => setCursor((c) => {
    const d = new Date(c.y, c.m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  // Monday-first grid with leading blanks.
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => dayKey(new Date(cursor.y, cursor.m, i + 1)))] as (string | null)[];
  }, [cursor]);

  const values = Object.values(moods).map((m) => m.mood);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const counts = MOODS.map((m) => values.filter((v) => v === m.value).length);
  const today = dayKey();
  const isThisMonth = cursor.y === new Date().getFullYear() && cursor.m === new Date().getMonth();
  const streak = (() => {
    let n = 0;
    for (let d = new Date(); moods[dayKey(d)]; d.setDate(d.getDate() - 1)) n++;
    return n;
  })();

  return (
    <Screen>
      <Card>
        <View style={styles.monthBar}>
          <Pressable onPress={() => shift(-1)} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.textSoft} />
          </Pressable>
          <Text style={type.title}>{new Date(cursor.y, cursor.m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })}</Text>
          <Pressable onPress={() => shift(1)} hitSlop={12} disabled={isThisMonth}>
            <Ionicons name="chevron-forward" size={22} color={isThisMonth ? colors.border : colors.textSoft} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {WEEKDAYS.map((w, i) => (
            <Text key={i} style={styles.weekday}>
              {w}
            </Text>
          ))}
          {cells.map((k, i) => {
            if (!k) return <View key={`b${i}`} style={styles.cell} />;
            const m = moods[k];
            const future = k > today;
            return (
              <Pressable key={k} style={styles.cell} disabled={future} onPress={() => setEditing(k)}>
                <View style={[styles.day, { backgroundColor: m ? moodOf(m.mood).tint : colors.surfaceSoft }, k === today && styles.today, future && { opacity: 0.35 }]}>
                  {m ? <Icon3D name={moodOf(m.mood).icon} size={26} /> : <Text style={styles.dayNum}>{parseDayKey(k).getDate()}</Text>}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Section title="This month">
        <Card>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              {avg != null ? <Icon3D name={moodOf(avg).icon} size={36} /> : <Text style={styles.statValue}>–</Text>}
              <Text style={type.small}>average{avg != null ? ` · ${avg.toFixed(1)}` : ''}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{values.length}</Text>
              <Text style={type.small}>days logged</Text>
            </View>
            {isThisMonth && (
              <View style={styles.stat}>
                <Text style={styles.statValue}>{streak}</Text>
                <Text style={type.small}>day streak</Text>
              </View>
            )}
          </View>
          {MOODS.slice()
            .reverse()
            .map((m) => (
              <View key={m.value} style={styles.distRow}>
                <Icon3D name={m.icon} size={22} />
                <Text style={[type.small, { width: 44 }]}>{m.label}</Text>
                <View style={{ flex: 1 }}>
                  <Bar value={counts[m.value - 1]} max={Math.max(1, ...counts)} color={m.deep} height={10} />
                </View>
                <Text style={[type.small, { width: 20, textAlign: 'right' }]}>{counts[m.value - 1]}</Text>
              </View>
            ))}
          {values.length >= 5 && (
            <Button
              title="What's shaping my moods?"
              variant="soft"
              icon="leaf"
              onPress={() =>
                router.push(
                  `/chat/wellbeing?prompt=${encodeURIComponent(
                    `Look at my moods this month (${Object.entries(moods)
                      .map(([d, m]) => `${d}: ${m.mood}/5${m.note ? ` "${m.note}"` : ''}`)
                      .join('; ')}). What patterns do you notice, and what should I do differently?`,
                  )}`,
                )
              }
            />
          )}
        </Card>
      </Section>

      <DayEditor day={editing} mood={editing ? moods[editing] : undefined} onClose={() => setEditing(null)} onSaved={load} />
    </Screen>
  );
}

function DayEditor({ day, mood, onClose, onSaved }: { day: string | null; mood?: Mood; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState('');
  const [value, setValue] = useState<number | null>(null);
  const current = value ?? mood?.mood ?? null;
  const close = () => {
    setNote('');
    setValue(null);
    onClose();
  };
  return (
    <Sheet visible={!!day} onClose={close} title={day ? parseDayKey(day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) : ''}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {MOODS.map((m) => (
          <Pressable key={m.value} onPress={() => setValue(m.value)} style={[styles.pick, current === m.value && { backgroundColor: m.tint }]}>
            <Icon3D name={m.icon} size={38} />
            <Text style={type.small}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder={mood?.note ?? 'What made it that way? (optional)'}
        placeholderTextColor={colors.textMuted}
        multiline
      />
      <Button
        title="Save"
        disabled={current == null}
        onPress={async () => {
          if (day && current != null) await setMood(current, note.trim() || null, day);
          onSaved();
          close();
        }}
      />
      {mood && (
        <Button
          title="Clear this day"
          variant="ghost"
          onPress={async () => {
            if (day) await clearMood(day);
            onSaved();
            close();
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontFamily: fonts.bodyHeavy, fontSize: 12, color: colors.textMuted, paddingBottom: 6 },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 3 },
  day: { flex: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 2, borderColor: colors.accent },
  dayNum: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.textMuted },
  statsRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  stat: { flex: 1, alignItems: 'center', gap: 4, backgroundColor: colors.surfaceSoft, borderRadius: radius.md, paddingVertical: space.sm },
  statValue: { fontFamily: fonts.display, fontSize: 26, color: colors.text, lineHeight: 36 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pick: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 8, borderRadius: 16 },
  input: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    minHeight: 72,
    textAlignVertical: 'top',
  },
});
