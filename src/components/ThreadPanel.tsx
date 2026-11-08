import { ReactNode, useCallback, useEffect, useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Resolved } from '@/data/spaces';
import { addDays, dayKey, Desire, kvGet, kvSet, parseDayKey, Song, Workout } from '@/lib/db';
import { DayAffirmations, listDesires, todaysAffirmations } from '@/lib/desires';
import { spendSummary } from '@/lib/finance';
import { useLive } from '@/lib/live';
import { mealsToday, totals } from '@/lib/food';
import { connectHealth, cycleInfo, CycleInfo, HealthSnapshot, logPeriodDay, recentWorkouts, snapshot } from '@/lib/health';
import { listSongs, logPractice, practiceStats, PracticeStats } from '@/lib/hobbies';
import { colors, fonts, radius, space, type } from '@/theme';
import { Bar } from './ui';
import { Icon3D } from './Icon3D';

// The live panel pinned above a card's chat. Collapsed it's a one-line
// summary; tap to expand. It folds away while the keyboard is open.

type Panel = { summary: string; body: ReactNode };

export function ThreadPanel({ t, refreshKey, hidden }: { t: Resolved; refreshKey: number; hidden: boolean }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    kvGet(`panel_open:${t.id}`).then((v) => setOpen(v !== '0'));
  }, [t.id]);

  // Rebuilds when the reply finishes (refreshKey), when the panel asks
  // (tick), and live whenever a coach's tool writes data mid-reply.
  const load = useCallback(async () => {
    try {
      setPanel(await build(t, reload));
    } catch {
      setPanel(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, refreshKey, tick, reload]);
  useLive(load, { focus: false, ignore: ['messages'] });

  if (!panel || hidden) return null;
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(!open);
    kvSet(`panel_open:${t.id}`, open ? '0' : '1').catch(() => {});
  };
  return (
    <View style={[styles.wrap, { backgroundColor: '#FFFFFFD9' }]}>
      <Pressable onPress={toggle} style={styles.summary} hitSlop={6}>
        <Icon3D name={t.icon} size={22} />
        <Text style={[styles.summaryText, { color: t.deep }]} numberOfLines={1}>
          {panel.summary}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.deep} />
      </Pressable>
      {open && (
        <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ gap: space.sm, paddingBottom: space.sm }} nestedScrollEnabled>
          {panel.body}
        </ScrollView>
      )}
    </View>
  );
}

function Chip({ label, onPress, color }: { label: string; onPress: () => void; color: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, { borderColor: color + '55' }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.mini}>
      <Text style={styles.miniValue}>{value}</Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

const agoText = (p: PracticeStats) =>
  p.daysSince == null ? 'No practice logged yet' : p.daysSince === 0 ? 'Practised today' : p.daysSince === 1 ? 'Last practised yesterday' : `${p.daysSince} days since you practised`;

async function build(t: Resolved, reload: () => void): Promise<Panel | null> {
  switch (t.panel) {
    case 'food': {
      const meals = await mealsToday();
      const m = totals(meals);
      return {
        summary: m.kcal ? `${m.kcal} kcal · ${m.protein} g protein · ${m.fibre} g fibre` : 'Nothing logged today',
        body: (
          <>
            <View style={styles.row}>
              <Mini label="kcal" value={String(m.kcal)} />
              <Mini label="protein" value={`${m.protein}g`} />
              <Mini label="carbs" value={`${m.carbs}g`} />
              <Mini label="fibre" value={`${m.fibre}g`} />
            </View>
            <Text style={type.small}>Protein</Text>
            <Bar value={m.protein} max={110} color={t.deep} />
            <Text style={type.small}>Fibre</Text>
            <Bar value={m.fibre} max={25} color={t.deep} />
            {meals.slice(0, 4).map((x) => (
              <Text key={x.id} style={type.small}>
                • {x.description} · {Math.round(x.kcal ?? 0)} kcal
              </Text>
            ))}
            <View style={styles.row}>
              <Chip label="📷 Snap a meal" color={t.deep} onPress={() => router.push('/food')} />
            </View>
          </>
        ),
      };
    }
    case 'move': {
      const [snap, w] = await Promise.all([snapshot().catch(() => null), recentWorkouts(14)]);
      return {
        summary: snap ? `${snap.today.steps.toLocaleString()} steps today · ${w.filter((x) => x.created_at > Date.now() - 7 * 86_400_000).length} workouts this week` : `${w.length} workouts in 2 weeks`,
        body: (
          <>
            {snap ? <StepsChart snap={snap} color={t.deep} /> : <ConnectHealth color={t.deep} onDone={reload} />}
            {snap && (
              <View style={styles.row}>
                <Mini label="active kcal" value={String(snap.today.activeKcal)} />
                <Mini label="sleep" value={snap.sleepHours ? `${snap.sleepHours}h` : '–'} />
                <Mini label="weight" value={snap.weightKg ? `${snap.weightKg}kg` : '–'} />
              </View>
            )}
            <WorkoutList list={w} />
          </>
        ),
      };
    }
    case 'cycle': {
      const c = await cycleInfo();
      return {
        summary: c.cycleDay ? `Day ${c.cycleDay} · ${c.phase} phase${c.lateBy ? ` · ${c.lateBy}d late` : ''}` : 'Log your last period to start tracking',
        body: <CycleBody c={c} color={t.deep} tint={t.tint} onChange={reload} />,
      };
    }
    case 'study': {
      const [exam, p] = await Promise.all([kvGet(`exam:${t.id}`), practiceStats(t.id)]);
      const days = exam ? Math.ceil((Date.parse(exam) - Date.now()) / 86_400_000) : null;
      return {
        summary: [days != null && days >= 0 ? `${days} days to exam` : 'Set your exam date', `${p.week} min this week`, p.streak ? `🔥 ${p.streak}` : null]
          .filter(Boolean)
          .join(' · '),
        body: <StudyBody t={t} exam={exam} p={p} onChange={reload} />,
      };
    }
    case 'guitar': {
      const [songs, p] = await Promise.all([listSongs(), practiceStats(t.id)]);
      return {
        summary: `${agoText(p)} · ${songs.filter((s) => s.status === 'learning').length} songs in progress`,
        body: <GuitarBody songs={songs} p={p} t={t} onChange={reload} />,
      };
    }
    case 'practice': {
      const p = await practiceStats(t.id);
      return {
        summary: `${agoText(p)}${p.week ? ` · ${p.week} min this week` : ''}`,
        body: <PracticeBody p={p} t={t} onChange={reload} />,
      };
    }
    case 'desires': {
      const [d, aff] = await Promise.all([listDesires(), todaysAffirmations()]);
      const pending = d.filter((x) => x.status === 'pending');
      return {
        summary: `${pending.length} assuming · ${d.length - pending.length} manifested`,
        body: <DesiresBody desires={d} aff={aff} color={t.deep} />,
      };
    }
    case 'advisor': {
      const s = await spendSummary();
      return {
        summary: s.latest ? `$${Math.round(s.month).toLocaleString()} spent this month · $${Math.round(s.lastMonth).toLocaleString()} last month` : 'Upload a statement so I can see your money',
        body: (
          <>
            <View style={styles.row}>
              <Mini label="this week" value={`$${Math.round(s.week)}`} />
              <Mini label="this month" value={`$${Math.round(s.month)}`} />
              <Mini label="this year" value={`$${Math.round(s.year)}`} />
            </View>
            <View style={styles.row}>
              <Chip label="Spending overview" color={t.deep} onPress={() => router.push('/finance')} />
              <Chip label="Upload statement" color={t.deep} onPress={() => router.push('/finance/statement')} />
            </View>
          </>
        ),
      };
    }
  }
  return null;
}

function StepsChart({ snap, color }: { snap: HealthSnapshot; color: string }) {
  const max = Math.max(10_000, ...snap.week.map((w) => w.steps));
  return (
    <View style={styles.chart}>
      {snap.week.map((w) => (
        <View key={w.day} style={styles.chartCol}>
          <View style={styles.chartTrack}>
            <View style={{ height: `${(100 * w.steps) / max}%`, backgroundColor: w.steps >= 8000 ? color : color + '66', borderRadius: 6 }} />
          </View>
          <Text style={styles.chartLabel}>{parseDayKey(w.day).toLocaleDateString([], { weekday: 'narrow' })}</Text>
        </View>
      ))}
    </View>
  );
}

function ConnectHealth({ color, onDone }: { color: string; onDone: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.bodySoft}>Connect Samsung Health to see steps, workouts, sleep and weight here.</Text>
      <View style={styles.row}>
        <Chip
          label="Connect Samsung Health"
          color={color}
          onPress={() =>
            connectHealth()
              .then(onDone)
              .catch((e: Error) => setMsg(e.message))
          }
        />
      </View>
      {msg && <Text style={type.small}>{msg}</Text>}
    </View>
  );
}

function WorkoutList({ list }: { list: Workout[] }) {
  if (!list.length) return <Text style={type.small}>No workouts in the last 2 weeks. Tell your coach what you did and it’ll log it.</Text>;
  return (
    <View style={{ gap: 4 }}>
      {list.slice(0, 6).map((w) => (
        <Text key={w.id} style={type.small}>
          {new Date(w.created_at).toLocaleDateString([], { weekday: 'short', day: 'numeric' })} · {w.title}
          {w.minutes ? ` · ${w.minutes} min` : ''}
          {w.source === 'samsung' ? ' · Samsung Health' : ''}
        </Text>
      ))}
    </View>
  );
}

function CycleBody({ c, color, tint, onChange }: { c: CycleInfo; color: string; tint: string; onChange: () => void }) {
  // Last 5 weeks as dots, period days filled.
  const days = Array.from({ length: 35 }, (_, i) => dayKey(addDays(new Date(), i - 34)));
  const set = new Set(c.periodDays);
  const today = dayKey();
  const onToday = set.has(today);
  return (
    <>
      <View style={styles.row}>
        <Mini label="cycle day" value={c.cycleDay ? String(c.cycleDay) : '–'} />
        <Mini label="avg length" value={c.avgLength ? `${c.avgLength}d` : '–'} />
        <Mini label="next" value={c.nextStart ? parseDayKey(c.nextStart).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '–'} />
      </View>
      <View style={styles.dots}>
        {days.map((d) => (
          <View
            key={d}
            style={[styles.dot, { backgroundColor: set.has(d) ? color : tint }, d === today && { borderWidth: 2, borderColor: colors.text }]}
          />
        ))}
      </View>
      <Text style={type.small}>Last 5 weeks. Filled dots are period days (from Samsung Health and what you log here).</Text>
      <View style={styles.row}>
        <Chip label={onToday ? 'Undo: period today' : 'Period started / today'} color={color} onPress={() => logPeriodDay(today, !onToday).then(onChange)} />
      </View>
    </>
  );
}

function StudyBody({ t, exam, p, onChange }: { t: Resolved; exam: string | null; p: PracticeStats; onChange: () => void }) {
  return (
    <>
      <View style={styles.row}>
        <Mini label="this week" value={`${p.week}m`} />
        <Mini label="streak" value={`${p.streak}d`} />
        <Mini label="exam" value={exam ? parseDayKey(exam).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '–'} />
      </View>
      <View style={styles.row}>
        {[25, 50, 90].map((m) => (
          <Chip key={m} label={`+ ${m} min studied`} color={t.deep} onPress={() => logPractice(t.id, m, null).then(onChange)} />
        ))}
      </View>
      <View style={styles.row}>
        <Chip label="Set exam date" color={t.deep} onPress={() => router.push(`/exam?thread=${t.id}`)} />
        {t.id === 'study.school' && <Chip label="Slides → notes" color={t.deep} onPress={() => router.push('/notes')} />}
      </View>
    </>
  );
}

function GuitarBody({ songs, p, t, onChange }: { songs: Song[]; p: PracticeStats; t: Resolved; onChange: () => void }) {
  return (
    <>
      <View style={styles.row}>
        <Mini label="this week" value={`${p.week}m`} />
        <Mini label="streak" value={`${p.streak}d`} />
        <Mini label="learned" value={String(songs.filter((s) => s.status === 'learned').length)} />
      </View>
      {songs.slice(0, 5).map((s) => (
        <Pressable key={s.id} onPress={() => router.push(`/songs/${s.id}`)} style={styles.songRow}>
          <Icon3D name={s.status === 'learned' ? 'star' : s.status === 'learning' ? 'guitar' : 'notes'} size={22} />
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { fontFamily: fonts.bodyBold }]} numberOfLines={1}>
              {s.title}
            </Text>
            <Text style={type.small}>
              {s.artist ? `${s.artist} · ` : ''}
              {s.status}
              {s.tabs ? ' · tabs saved' : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      ))}
      <View style={styles.row}>
        <Chip label="All songs" color={t.deep} onPress={() => router.push('/songs')} />
        <Chip label="+ 15 min practised" color={t.deep} onPress={() => logPractice(t.id, 15, null).then(onChange)} />
        <Chip label="+ 30 min" color={t.deep} onPress={() => logPractice(t.id, 30, null).then(onChange)} />
      </View>
    </>
  );
}

function PracticeBody({ p, t, onChange }: { p: PracticeStats; t: Resolved; onChange: () => void }) {
  return (
    <>
      <View style={styles.row}>
        <Mini label="this week" value={`${p.week}m`} />
        <Mini label="streak" value={`${p.streak}d`} />
      </View>
      {p.recent
        .filter((r) => r.note)
        .slice(0, 4)
        .map((r, i) => (
          <Text key={i} style={type.small}>
            • {r.note}
          </Text>
        ))}
      <View style={styles.row}>
        {[15, 30, 60].map((m) => (
          <Chip key={m} label={`+ ${m} min`} color={t.deep} onPress={() => logPractice(t.id, m, null).then(onChange)} />
        ))}
      </View>
    </>
  );
}

function DesiresBody({ desires, aff, color }: { desires: Desire[]; aff: DayAffirmations | null; color: string }) {
  const evening = new Date().getHours() >= 17;
  return (
    <>
      {aff && <Text style={[type.quote, { fontSize: 15 }]}>“{evening ? aff.night : aff.morning}”</Text>}
      {desires.slice(0, 5).map((d) => (
        <View key={d.id} style={styles.songRow}>
          <Icon3D name={d.status === 'manifested' ? 'star' : 'desire'} size={22} />
          <Text style={[type.body, { flex: 1 }, d.status === 'manifested' && { color: colors.textMuted }]} numberOfLines={1}>
            {d.title}
          </Text>
        </View>
      ))}
      <View style={styles.row}>
        <Chip label="Open my desires" color={color} onPress={() => router.push('/desires')} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: space.md, marginTop: space.sm, borderRadius: radius.md, paddingHorizontal: space.md },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  summaryText: { flex: 1, fontFamily: fonts.bodyHeavy, fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#FFFFFFCC' },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13 },
  mini: { flex: 1, minWidth: 64, backgroundColor: colors.surfaceSoft, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10 },
  miniValue: { fontFamily: fonts.display, fontSize: 18, color: colors.text },
  chart: { flexDirection: 'row', gap: 6, height: 90, alignItems: 'flex-end' },
  chartCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  chartTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', backgroundColor: colors.surfaceSoft, borderRadius: 6 },
  chartLabel: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.textMuted },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 },
});
