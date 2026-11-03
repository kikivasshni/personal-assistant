import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button, Card, Empty, PageHeader, Pill, Screen, Section, Stat } from '@/components/ui';
import { colors, fonts, gradients, palette, radius, shadow, space, type } from '@/theme';
import { coach } from '@/data/coaches';
import { Briefing, cachedBriefing, makeBriefing } from '@/lib/briefing';
import { commitmentsForDay, createCommitment, recentStats, setCommitmentStatus } from '@/lib/commitments';
import { Commitment, db } from '@/lib/db';
import { mealsToday, totals } from '@/lib/food';
import { CalEvent, eventTime, listEvents } from '@/lib/integrations/google';
import { GOOGLE, isConnected } from '@/lib/integrations/oauth';
import { ensurePermission } from '@/lib/nags';

const MOODS = [
  { label: 'Rough', tint: palette.rose, dot: palette.roseDeep },
  { label: 'Low', tint: palette.peach, dot: palette.peachDeep },
  { label: 'Okay', tint: palette.butter, dot: palette.butterDeep },
  { label: 'Good', tint: palette.mint, dot: palette.mintDeep },
  { label: 'Great', tint: palette.sky, dot: palette.skyDeep },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Today() {
  const params = useLocalSearchParams<{ briefing?: string }>();
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [briefing, setBriefing] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const [items, setItems] = useState<Commitment[]>([]);
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [food, setFood] = useState({ kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 });
  const [stats, setStats] = useState({ done: 0, missed: 0, open: 0 });
  const [mood, setMood] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setItems(await commitmentsForDay());
    setFood(totals(await mealsToday()));
    setStats(await recentStats(7));
    setBrief(await cachedBriefing());
    if (await isConnected(GOOGLE)) listEvents(1).then(setEvents).catch(() => setEvents(null));
  }, []);

  const runBriefing = useCallback(async (force = false) => {
    setBriefing(true);
    setBriefErr(null);
    try {
      setBrief(await makeBriefing(force));
    } catch (e) {
      setBriefErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBriefing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      ensurePermission().catch(() => {});
      if (params.briefing) runBriefing(false);
    }, [load, params.briefing, runBriefing]),
  );

  const toggle = async (c: Commitment) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await setCommitmentStatus(c.id, c.status === 'done' ? 'open' : 'done');
    load();
  };

  const saveMood = async (m: number) => {
    setMood(m);
    await (await db()).runAsync('INSERT INTO moods(mood, created_at) VALUES(?, ?)', m + 1, Date.now());
  };

  const evening = new Date().getHours() >= 18;
  const open = items.filter((i) => i.status === 'open');

  return (
    <Screen
      header={
        <PageHeader
          eyebrow={new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
          title={`${greeting()}, kirthi`}
        />
      }
    >
      <LinearGradient colors={evening ? gradients.night : gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTop}>
          <Text style={type.label}>{evening ? 'Tonight' : "Today's briefing"}</Text>
          <Pressable onPress={() => runBriefing(true)} hitSlop={12} disabled={briefing}>
            {briefing ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="refresh" size={18} color={colors.accent} />}
          </Pressable>
        </View>
        {brief ? (
          <>
            <Text style={type.quote}>“{brief.affirmation}”</Text>
            <Text style={type.bodySoft}>{brief.greeting}</Text>
            <View style={{ gap: 6, marginTop: space.xs }}>
              {(Array.isArray(brief.focus) ? brief.focus : []).map((f, i) => (
                <View key={i} style={styles.focusRow}>
                  <View style={styles.focusDot}>
                    <Text style={styles.focusNum}>{i + 1}</Text>
                  </View>
                  <Text style={[type.body, { flex: 1 }]}>{f}</Text>
                </View>
              ))}
            </View>
            <Text style={type.bodySoft}>{brief.schedule}</Text>
            <Text style={[type.small, { color: colors.textSoft }]}>{brief.nudge}</Text>
          </>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text style={type.bodySoft}>
              {briefErr ?? 'Kairos reads your calendar, tasks and goals and plans the day with you.'}
            </Text>
            {briefErr?.includes('Settings') ? (
              <Button title="Open settings" variant="soft" onPress={() => router.push('/settings')} />
            ) : (
              <Button title="Plan my day" icon="sparkles" onPress={() => runBriefing(false)} loading={briefing} />
            )}
          </View>
        )}
      </LinearGradient>

      {evening && (
        <Card tint={palette.lilac} onPress={() => router.push('/chat/hq?audit=1')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Ionicons name="moon" size={18} color={palette.lilacDeep} />
            <Text style={type.heading}>Evening audit</Text>
          </View>
          <Text style={type.bodySoft}>Two minutes with Planner: what got done, what slipped, what moves to tomorrow.</Text>
        </Card>
      )}

      <Section title="How are you feeling?">
        <Card>
          <View style={styles.moodRow}>
            {MOODS.map((m, i) => (
              <Pressable key={m.label} onPress={() => saveMood(i)} style={[styles.mood, { backgroundColor: mood === i ? m.tint : colors.surfaceSoft }]}>
                <View style={[styles.moodDot, { backgroundColor: m.dot }]} />
                <Text style={styles.moodText}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
          {mood != null && mood <= 1 && (
            <Button title="Talk it through" variant="soft" icon="leaf" onPress={() => router.push('/chat/wellbeing')} />
          )}
          {mood != null && mood > 1 && <Text style={[type.small, { textAlign: 'center' }]}>Noted. Your coaches will see this.</Text>}
        </Card>
      </Section>

      <Section
        title={`Commitments · ${open.length} open`}
        action={
          <Pressable onPress={() => setAdding(true)} hitSlop={10}>
            <Text style={styles.link}>+ Add</Text>
          </Pressable>
        }
      >
        {items.length === 0 ? (
          <Card>
            <Empty icon="checkmark-done-outline" title="Nothing locked in yet" body="Tell any coach what you'll do and when, and it'll hold you to it." />
          </Card>
        ) : (
          <Card style={{ gap: 0, paddingVertical: space.sm }}>
            {items.map((c, i) => {
              const k = coach(c.coach);
              const late = c.status === 'open' && c.due_at < Date.now();
              return (
                <Pressable
                  key={c.id}
                  onPress={() => toggle(c)}
                  onLongPress={() => setCommitmentStatus(c.id, 'dropped').then(load)}
                  style={[styles.item, i > 0 && styles.itemBorder]}
                >
                  <View style={[styles.check, c.status === 'done' && { backgroundColor: k.deep, borderColor: k.deep }]}>
                    {c.status === 'done' && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, c.status !== 'open' && styles.doneText]}>{c.title}</Text>
                    <Text style={[type.small, late && { color: colors.danger }]}>
                      {k.name} · {new Date(c.due_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      {late ? ' · overdue' : c.status === 'missed' ? ' · missed' : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}
      </Section>

      {events && (
        <Section title="Calendar">
          <Card style={{ gap: 10 }}>
            {events.length === 0 ? (
              <Text style={type.bodySoft}>Nothing on the calendar today.</Text>
            ) : (
              events.map((e) => (
                <View key={e.id} style={styles.eventRow}>
                  <Text style={[type.small, { width: 72 }]}>{eventTime(e)}</Text>
                  <Text style={[type.body, { flex: 1 }]}>{e.summary}</Text>
                </View>
              ))
            )}
          </Card>
        </Section>
      )}

      <Section title="Nourish">
        <Pressable onPress={() => router.push('/studio/food')}>
          <View style={styles.stats}>
            <Stat label="kcal" value={String(food.kcal)} tint={palette.peach} />
            <Stat label="protein g" value={String(food.protein)} tint={palette.rose} />
            <Stat label="carbs g" value={String(food.carbs)} tint={palette.butter} />
          </View>
        </Pressable>
      </Section>

      <Section title="Last 7 days">
        <View style={styles.stats}>
          <Stat label="done" value={String(stats.done)} tint={palette.mint} />
          <Stat label="missed" value={String(stats.missed)} tint={palette.rose} />
          <Stat
            label="follow-through"
            value={stats.done + stats.missed ? `${Math.round((100 * stats.done) / (stats.done + stats.missed))}%` : '–'}
            tint={palette.lavender}
          />
        </View>
      </Section>

      <QuickAdd visible={adding} onClose={() => setAdding(false)} onSaved={load} />
    </Screen>
  );
}

function QuickAdd({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [preset, setPreset] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const presets = [
    { label: 'In 1 hour', at: () => Date.now() + 3_600_000 },
    { label: 'Tonight 8pm', at: () => at(new Date(), 20, 0) },
    { label: 'Tomorrow 9am', at: () => at(new Date(Date.now() + 86_400_000), 9, 0) },
  ];

  const resolve = (): number | null => {
    if (time.trim()) {
      const m = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
      if (!m) return null;
      let h = parseInt(m[1], 10);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
      if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
      let t = at(new Date(), h, min);
      if (t < Date.now()) t += 86_400_000;
      return t;
    }
    return preset != null ? presets[preset].at() : null;
  };

  const save = async () => {
    const due = resolve();
    if (!title.trim() || !due) return;
    setSaving(true);
    try {
      await createCommitment('hq', title.trim(), due);
      setTitle('');
      setTime('');
      setPreset(null);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={type.title}>Lock something in</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. 20 min guitar ear training"
          placeholderTextColor={colors.textMuted}
          autoFocus
        />
        <View style={styles.presetRow}>
          {presets.map((p, i) => (
            <Pill key={p.label} label={p.label} active={preset === i && !time} onPress={() => setPreset(i)} />
          ))}
        </View>
        <TextInput
          style={styles.input}
          value={time}
          onChangeText={setTime}
          placeholder="or a time, e.g. 7:30pm"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
        <Text style={type.small}>You'll get a reminder, a firmer one 30 minutes later, then the Motivation coach steps in.</Text>
        <Button title="Commit" onPress={save} loading={saving} disabled={!title.trim() || !resolve()} />
      </View>
    </Modal>
  );
}

function at(d: Date, h: number, m: number) {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x.getTime();
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: space.lg, gap: space.sm, ...shadow },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  focusRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  focusDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFFAA',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  focusNum: { fontFamily: fonts.bodyHeavy, fontSize: 12, color: colors.accent },
  moodRow: { flexDirection: 'row', gap: 6 },
  mood: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 16 },
  moodDot: { width: 14, height: 14, borderRadius: 7 },
  moodText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.textSoft },
  link: { fontFamily: fonts.bodyHeavy, color: colors.accent, fontSize: 14 },
  item: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: 12 },
  itemBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { color: colors.textMuted, textDecorationLine: 'line-through' },
  eventRow: { flexDirection: 'row', alignItems: 'center' },
  stats: { flexDirection: 'row', gap: space.sm },
  backdrop: { flex: 1, backgroundColor: '#2E2A3B55' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
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
  },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
