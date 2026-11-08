import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useLive } from '@/lib/live';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button, Card, PageHeader, Pill, Screen, Section, Segmented, Sheet } from '@/components/ui';
import { HabitsCard } from '@/components/HabitsCard';
import { Icon3D } from '@/components/Icon3D';
import { resolve } from '@/data/spaces';
import { Briefing, cachedBriefing, makeBriefing } from '@/lib/briefing';
import { commitmentsForDay, createCommitment, recentStats, setCommitmentStatus } from '@/lib/commitments';
import { addDays, Commitment, dayKey, Mood } from '@/lib/db';
import { mealsToday, totals } from '@/lib/food';
import { cycleInfo, snapshot } from '@/lib/health';
import { CalEvent, eventTime, listEvents } from '@/lib/integrations/google';
import { GOOGLE, isConnected } from '@/lib/integrations/oauth';
import { MOODS, moodOf, moodsForMonth, setMood } from '@/lib/moods';
import { ensurePermission } from '@/lib/nags';
import { addTask, dueChoices, groupTasks, listTasks, setTaskDone, Task, TaskGroups, tasksConnected } from '@/lib/tasks';
import { colors, fonts, gradients, palette, radius, shadow, space, type } from '@/theme';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

type TaskView = 'today' | 'week' | 'anytime';

export default function Today() {
  const params = useLocalSearchParams<{ briefing?: string }>();
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [briefing, setBriefing] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [tasks, setTasks] = useState<TaskGroups | null>(null);
  const [tasksErr, setTasksErr] = useState<string | null>(null);
  const [hasTasks, setHasTasks] = useState(true);
  const [view, setView] = useState<TaskView>('today');
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [tiles, setTiles] = useState<{ kcal: number; protein: number; steps: number | null; cycle: string | null }>({ kcal: 0, protein: 0, steps: null, cycle: null });
  const [stats, setStats] = useState({ done: 0, missed: 0, open: 0 });
  const [week, setWeek] = useState<Record<string, Mood>>({});
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadMoods = useCallback(async () => {
    const now = new Date();
    const prev = addDays(now, -6);
    const a = await moodsForMonth(now.getFullYear(), now.getMonth());
    const b = prev.getMonth() !== now.getMonth() ? await moodsForMonth(prev.getFullYear(), prev.getMonth()) : {};
    setWeek({ ...b, ...a });
  }, []);

  const loadTasks = useCallback(async () => {
    const ok = await tasksConnected();
    setHasTasks(ok);
    if (!ok) return;
    try {
      setTasks(groupTasks(await listTasks()));
      setTasksErr(null);
    } catch (e) {
      setTasksErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const load = useCallback(async () => {
    setCommitments(await commitmentsForDay());
    setStats(await recentStats(7));
    setBrief(await cachedBriefing());
    loadMoods();
    loadTasks();
    const food = totals(await mealsToday());
    setTiles((t) => ({ ...t, kcal: food.kcal, protein: food.protein }));
    snapshot()
      .then((s) => s && setTiles((t) => ({ ...t, steps: s.today.steps })))
      .catch(() => {});
    cycleInfo()
      .then((c) => c.cycleDay && setTiles((t) => ({ ...t, cycle: `Day ${c.cycleDay}` })))
      .catch(() => {});
    if (await isConnected(GOOGLE)) listEvents(1).then(setEvents).catch(() => setEvents(null));
  }, [loadMoods, loadTasks]);

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

  // Reloads on focus and whenever data changes (chat messages excluded: they
  // don't affect Today, and the load also calls Notion, Google and Health).
  useLive(load, { ignore: ['messages'] });
  useFocusEffect(
    useCallback(() => {
      ensurePermission().catch(() => {});
      if (params.briefing) runBriefing(false);
    }, [params.briefing, runBriefing]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleCommitment = async (c: Commitment) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await setCommitmentStatus(c.id, c.status === 'done' ? 'open' : 'done');
    setCommitments(await commitmentsForDay());
  };

  const toggleTask = async (t: Task) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Optimistic: tick it now, sync in the background.
    setTasks((g) => g && (Object.fromEntries(Object.entries(g).map(([k, list]) => [k, list.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x))])) as TaskGroups));
    try {
      await setTaskDone(t, !t.done);
    } catch (e) {
      setTasksErr(e instanceof Error ? e.message : String(e));
      loadTasks();
    }
  };

  const pickMood = async (v: number) => {
    Haptics.selectionAsync().catch(() => {});
    await setMood(v);
    loadMoods();
  };

  const evening = new Date().getHours() >= 18;
  const today = dayKey();
  const todayMood = week[today]?.mood ?? null;
  const shown = tasks ? tasks[view] : [];
  const openCommitments = commitments.filter((c) => c.status === 'open');

  return (
    <Screen
      onRefresh={refresh}
      refreshing={refreshing}
      header={<PageHeader eyebrow={new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} title={`${greeting()}, kirthi`} />}
    >
      <LinearGradient colors={evening ? gradients.night : gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.row}>
            <Icon3D name={evening ? 'moon' : 'sun'} size={28} />
            <Text style={type.label}>{evening ? 'Tonight' : "Today's briefing"}</Text>
          </View>
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
            <Text style={type.bodySoft}>{briefErr ?? 'Kairos reads your calendar, tasks and goals and plans the day with you.'}</Text>
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
          <View style={styles.row}>
            <Icon3D name="moon" size={26} />
            <Text style={type.heading}>Evening audit</Text>
          </View>
          <Text style={type.bodySoft}>Two minutes with Planner: what got done, what slipped, what moves to tomorrow.</Text>
        </Card>
      )}

      <Section
        title="How are you feeling?"
        action={
          <Pressable onPress={() => router.push('/mood')} hitSlop={10}>
            <Text style={styles.link}>Month →</Text>
          </Pressable>
        }
      >
        <Card>
          <View style={styles.moodRow}>
            {MOODS.map((m) => {
              const on = todayMood === m.value;
              return (
                <Pressable key={m.value} onPress={() => pickMood(m.value)} style={[styles.mood, { backgroundColor: on ? m.tint : 'transparent' }]}>
                  <View style={{ opacity: todayMood == null || on ? 1 : 0.45, transform: [{ scale: on ? 1.08 : 1 }] }}>
                    <Icon3D name={m.icon} size={40} />
                  </View>
                  <Text style={[styles.moodText, on && { color: m.deep }]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => router.push('/mood')} style={styles.weekStrip}>
            {Array.from({ length: 7 }, (_, i) => addDays(new Date(), i - 6)).map((d) => {
              const k = dayKey(d);
              const m = week[k];
              return (
                <View key={k} style={styles.weekDay}>
                  <View style={[styles.weekDot, { backgroundColor: m ? moodOf(m.mood).tint : colors.surfaceSoft }]}>
                    {m ? <Icon3D name={moodOf(m.mood).icon} size={20} /> : null}
                  </View>
                  <Text style={[styles.weekLabel, k === today && { color: colors.accent }]}>{d.toLocaleDateString([], { weekday: 'narrow' })}</Text>
                </View>
              );
            })}
          </Pressable>
          {todayMood != null && todayMood <= 2 && (
            <Button title="Talk it through" variant="soft" icon="leaf" onPress={() => router.push('/chat/wellbeing')} />
          )}
        </Card>
      </Section>

      <HabitsCard />

      <Section
        title="To-do"
        action={
          <Pressable onPress={() => setAdding(true)} hitSlop={10}>
            <Text style={styles.link}>+ Add</Text>
          </Pressable>
        }
      >
        {!hasTasks ? (
          <Card tint={palette.sky} onPress={() => router.push('/settings')}>
            <View style={styles.row}>
              <Icon3D name="check" size={32} />
              <Text style={[type.heading, { flex: 1 }]}>Connect Microsoft To Do</Text>
            </View>
            <Text style={type.bodySoft}>Your tasks live in To Do, sync to Samsung Reminder, and mirror into your Notion tasks database.</Text>
          </Card>
        ) : (
          <Card style={{ gap: space.sm }}>
            <Segmented<TaskView>
              value={view}
              onChange={setView}
              options={[
                { value: 'today', label: `Today${tasks ? ` · ${tasks.today.filter((x) => !x.done).length}` : ''}` },
                { value: 'week', label: `Week${tasks ? ` · ${tasks.week.filter((x) => !x.done).length}` : ''}` },
                { value: 'anytime', label: 'Anytime' },
              ]}
            />
            {!tasks && !tasksErr && <ActivityIndicator color={colors.accent} style={{ padding: space.md }} />}
            {tasksErr && <Text style={[type.small, { color: colors.danger }]}>{tasksErr}</Text>}
            {tasks && shown.length === 0 && (
              <Text style={[type.bodySoft, { textAlign: 'center', paddingVertical: space.md }]}>
                {view === 'today' ? 'Nothing due today. Add something, or ask Planner to plan it.' : view === 'week' ? 'Nothing else due this week.' : 'No undated tasks.'}
              </Text>
            )}
            {shown.map((t, i) => (
              <Pressable key={t.id} onPress={() => toggleTask(t)} style={[styles.item, i > 0 && styles.itemBorder]}>
                <View style={[styles.check, t.done && { backgroundColor: colors.success, borderColor: colors.success }]}>
                  {t.done && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, t.done && styles.doneText]}>{t.title}</Text>
                  {(view !== 'today' || (t.due && t.due < today)) && t.due ? (
                    <Text style={[type.small, t.due < today && !t.done && { color: colors.danger }]}>
                      {t.due < today ? 'overdue · ' : ''}
                      {new Date(`${t.due}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </Card>
        )}
      </Section>

      {commitments.length > 0 && (
        <Section title={`Locked in · ${openCommitments.length} open`}>
          <Card style={{ gap: 0, paddingVertical: space.sm }}>
            {commitments.map((c, i) => {
              const k = resolve(c.coach);
              const late = c.status === 'open' && c.due_at < Date.now();
              return (
                <Pressable
                  key={c.id}
                  onPress={() => toggleCommitment(c)}
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
                  <Icon3D name={k.icon} size={26} />
                </Pressable>
              );
            })}
          </Card>
        </Section>
      )}

      {events && events.length > 0 && (
        <Section title="Calendar">
          <Card style={{ gap: 10 }}>
            {events.map((e) => (
              <View key={e.id} style={styles.row}>
                <Text style={[type.small, { width: 72 }]}>{eventTime(e)}</Text>
                <Text style={[type.body, { flex: 1 }]}>{e.summary}</Text>
              </View>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Body">
        <View style={styles.tiles}>
          <Tile icon="food" value={String(tiles.kcal)} label={`kcal · ${tiles.protein} g protein`} tint={palette.peach} onPress={() => router.push('/chat/health.food')} />
          <Tile icon="steps" value={tiles.steps != null ? tiles.steps.toLocaleString() : '–'} label="steps" tint={palette.mint} onPress={() => router.push('/chat/health.move')} />
          <Tile icon="pcos" value={tiles.cycle ?? '–'} label="cycle" tint={palette.rose} onPress={() => router.push('/chat/health.pcos')} />
        </View>
      </Section>

      <Section title="Last 7 days">
        <View style={styles.tiles}>
          <Tile icon="check" value={String(stats.done)} label="done" tint={palette.mint} />
          <Tile icon="fire" value={stats.done + stats.missed ? `${Math.round((100 * stats.done) / (stats.done + stats.missed))}%` : '–'} label="follow-through" tint={palette.butter} />
          <Tile icon="target" value={String(stats.missed)} label="missed" tint={palette.rose} />
        </View>
      </Section>

      <AddSheet
        visible={adding}
        canTask={hasTasks}
        onClose={() => setAdding(false)}
        onSaved={() => {
          load();
        }}
      />
    </Screen>
  );
}

function Tile({ icon, value, label, tint, onPress }: { icon: string; value: string; label: string; tint: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.tile, { backgroundColor: tint }, pressed && { opacity: 0.85 }]}>
      <Icon3D name={icon} size={28} />
      <Text style={styles.tileValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={type.small} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// Add a to-do (synced to To Do / Samsung Reminder / Notion) or lock in a
// timed commitment with escalating nags.
function AddSheet({ visible, canTask, onClose, onSaved }: { visible: boolean; canTask: boolean; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<'task' | 'commit'>(canTask ? 'task' : 'commit');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<string | null>(dayKey());
  const [time, setTime] = useState('');
  const [preset, setPreset] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const presets = [
    { label: 'In 1 hour', at: () => Date.now() + 3_600_000 },
    { label: 'Tonight 8pm', at: () => at(new Date(), 20, 0) },
    { label: 'Tomorrow 9am', at: () => at(addDays(new Date(), 1), 9, 0) },
  ];

  const resolveTime = (): number | null => {
    if (time.trim()) {
      const m = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
      if (!m) return null;
      let h = parseInt(m[1], 10);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
      if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
      let ts = at(new Date(), h, min);
      if (ts < Date.now()) ts += 86_400_000;
      return ts;
    }
    return preset != null ? presets[preset].at() : null;
  };

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      if (kind === 'task') await addTask(title.trim(), due);
      else {
        const ts = resolveTime();
        if (!ts) return;
        await createCommitment('hq', title.trim(), ts);
      }
      setTitle('');
      setTime('');
      setPreset(null);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={kind === 'task' ? 'New to-do' : 'Lock something in'}>
      {canTask && (
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'task', label: 'To-do' },
            { value: 'commit', label: 'Commit with nags' },
          ]}
        />
      )}
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder={kind === 'task' ? 'e.g. Submit internship timesheet' : 'e.g. 20 min guitar ear training'}
        placeholderTextColor={colors.textMuted}
        autoFocus
      />
      {kind === 'task' ? (
        <>
          <View style={styles.presetRow}>
            {dueChoices().map((c) => (
              <Pill key={c.label} label={c.label} active={due === c.day} onPress={() => setDue(c.day)} />
            ))}
          </View>
          <Text style={type.small}>Goes to Microsoft To Do, which syncs to Samsung Reminder and your Notion tasks.</Text>
        </>
      ) : (
        <>
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
          <Text style={type.small}>You’ll get a reminder, a firmer one 30 minutes later, then the Motivation coach steps in.</Text>
        </>
      )}
      {err && <Text style={[type.small, { color: colors.danger }]}>{err}</Text>}
      <Button title={kind === 'task' ? 'Add' : 'Commit'} onPress={save} loading={saving} disabled={!title.trim() || (kind === 'commit' && !resolveTime())} />
    </Sheet>
  );
}

function at(d: Date, h: number, m: number) {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x.getTime();
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  hero: { borderRadius: radius.lg, padding: space.lg, gap: space.sm, ...shadow },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  focusRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  focusDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFFAA', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  focusNum: { fontFamily: fonts.bodyHeavy, fontSize: 12, color: colors.accent },
  moodRow: { flexDirection: 'row', gap: 4 },
  mood: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 8, borderRadius: 18 },
  moodText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.textSoft },
  weekStrip: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
  weekDay: { alignItems: 'center', gap: 3 },
  weekDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted },
  link: { fontFamily: fonts.bodyHeavy, color: colors.accent, fontSize: 14 },
  item: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: 11 },
  itemBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: colors.textMuted, textDecorationLine: 'line-through' },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, borderRadius: radius.md, padding: space.md, gap: 2 },
  tileValue: { fontFamily: fonts.display, fontSize: 20, color: colors.text, marginTop: 4 },
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
