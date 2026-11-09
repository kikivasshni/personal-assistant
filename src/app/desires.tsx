import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useLive } from '@/lib/live';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Button, Card, Field, Screen, Section, Sheet } from '@/components/ui';
import { Icon3D } from '@/components/Icon3D';
import { Desire } from '@/lib/db';
import { AffirmationTimes, DayAffirmations, deleteDesire, getAffirmationTimes, listDesires, saveDesire, scheduleAffirmations, todaysAffirmations } from '@/lib/desires';
import { ensurePermission } from '@/lib/nags';
import { colors, fonts, palette, radius, shadow, space, type } from '@/theme';

const since = (ms: number) => {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d < 1 ? 'today' : d === 1 ? '1 day' : `${d} days`;
};

export default function Desires() {
  const [list, setList] = useState<Desire[]>([]);
  const [aff, setAff] = useState<DayAffirmations | null>(null);
  const [times, setTimes] = useState<AffirmationTimes>({ morning: '07:30', night: '22:30' });
  const [adding, setAdding] = useState(false);
  const [celebrating, setCelebrating] = useState<Desire | null>(null);
  const [busy, setBusy] = useState(false);

  // Desires and today's affirmation update live: a coach can save a desire
  // mid-chat, and new affirmations are written in the background after you
  // add one. The time fields load once so they're never reset while editing.
  const load = useCallback(async () => {
    setList(await listDesires());
    setAff(await todaysAffirmations());
  }, []);
  useLive(load, { tables: ['desires', 'kv'] });
  useEffect(() => {
    getAffirmationTimes().then(setTimes);
  }, []);

  const refreshAffirmations = async () => {
    setBusy(true);
    try {
      if (!list.some((d) => d.status === 'pending')) throw new Error('Add a desire first. Affirmations are written from the desires you’re assuming.');
      if (!(await ensurePermission())) throw new Error('Allow notifications for Kairos first.');
      const n = await scheduleAffirmations(true, times);
      Alert.alert('Affirmations set', `${n} morning and night affirmations scheduled for the next 7 days.`);
      load();
    } catch (e) {
      Alert.alert("Couldn't schedule", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pending = list.filter((d) => d.status === 'pending');
  const done = list.filter((d) => d.status === 'manifested');
  const evening = new Date().getHours() >= 17;

  return (
    <Screen>
      <LinearGradient colors={[palette.lilac, palette.lavender]} style={styles.hero}>
        <Icon3D name={evening ? 'moon' : 'sun'} size={36} />
        <Text style={type.label}>{evening ? "Tonight's assumption" : "This morning's assumption"}</Text>
        <Text style={[type.quote, { fontSize: 20, lineHeight: 28 }]}>
          “{aff ? (evening ? aff.night : aff.morning) : 'I live from the end. It is already done.'}”
        </Text>
        {aff && <Text style={type.small}>{evening ? `This morning: “${aff.morning}”` : `Tonight: “${aff.night}”`}</Text>}
      </LinearGradient>

      <Section
        title={`Assuming · ${pending.length}`}
        action={
          <Pressable onPress={() => setAdding(true)} hitSlop={10}>
            <Text style={styles.link}>+ New desire</Text>
          </Pressable>
        }
      >
        {pending.length === 0 && (
          <Card>
            <Text style={type.bodySoft}>Name a desire as the end result, as if it’s already yours.</Text>
          </Card>
        )}
        {pending.map((d) => (
          <Card key={d.id} style={{ gap: 6 }}>
            <View style={styles.row}>
              <Icon3D name="desire" size={34} />
              <View style={{ flex: 1 }}>
                <Text style={type.heading}>{d.title}</Text>
                <Text style={type.small}>Assuming for {since(d.created_at)}</Text>
              </View>
            </View>
            {d.detail ? <Text style={type.bodySoft}>{d.detail}</Text> : null}
            {d.scene ? (
              <View style={styles.scene}>
                <Text style={type.label}>Your scene</Text>
                <Text style={[type.quote, { fontSize: 15 }]}>{d.scene}</Text>
              </View>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                style={[styles.action, { backgroundColor: palette.lilac }]}
                onPress={() => router.push(`/chat/manifest.desires?prompt=${encodeURIComponent(`Give me a SATS scene for "${d.title}" for tonight, and save it to the desire.`)}`)}
              >
                <Text style={[styles.actionText, { color: palette.lilacDeep }]}>Scene for tonight</Text>
              </Pressable>
              <Pressable style={[styles.action, { backgroundColor: palette.butter }]} onPress={() => setCelebrating(d)}>
                <Text style={[styles.actionText, { color: palette.butterDeep }]}>It manifested</Text>
              </Pressable>
            </View>
          </Card>
        ))}
      </Section>

      {done.length > 0 && (
        <Section title={`Manifested · ${done.length}`}>
          <Card style={{ gap: 0, paddingVertical: space.xs }}>
            {done.map((d, i) => (
              <Pressable
                key={d.id}
                onLongPress={() =>
                  Alert.alert('Remove this?', d.title, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => deleteDesire(d.id).then(load) },
                  ])
                }
                style={[styles.doneRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <Icon3D name="star" size={28} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { fontFamily: fonts.bodyBold }]}>{d.title}</Text>
                  <Text style={type.small}>
                    {d.manifested_at ? new Date(d.manifested_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                    {d.story ? ` · ${d.story}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Daily affirmations">
        <Card>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field label="Morning" value={times.morning} onChangeText={(v) => setTimes((t) => ({ ...t, morning: v }))} keyboardType="numbers-and-punctuation" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Night" value={times.night} onChangeText={(v) => setTimes((t) => ({ ...t, night: v }))} keyboardType="numbers-and-punctuation" />
            </View>
          </View>
          <Button title="Write and schedule this week's affirmations" variant="soft" icon="sparkles" loading={busy} onPress={refreshAffirmations} />
          <Text style={type.small}>New ones are written from your desires every week, and whenever your desires change.</Text>
        </Card>
      </Section>

      <Button title="Talk to your manifestation coach" variant="ghost" onPress={() => router.push('/chat/manifest.desires')} />

      <AddDesire visible={adding} onClose={() => setAdding(false)} onSaved={load} />
      <Celebrate desire={celebrating} onClose={() => setCelebrating(null)} onSaved={load} />
    </Screen>
  );
}

function AddDesire({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  return (
    <Sheet visible={visible} onClose={onClose} title="New desire">
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. I'm a pilot with a major airline" placeholderTextColor={colors.textMuted} autoFocus />
      <TextInput
        style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
        value={detail}
        onChangeText={setDetail}
        placeholder="Specifics: what it looks and feels like when it's done"
        placeholderTextColor={colors.textMuted}
        multiline
      />
      <Button
        title="Assume it"
        disabled={!title.trim()}
        onPress={async () => {
          await saveDesire({ title: title.trim(), detail: detail.trim() || null });
          setTitle('');
          setDetail('');
          onSaved();
          onClose();
          scheduleAffirmations(true).catch(() => {});
        }}
      />
    </Sheet>
  );
}

function Celebrate({ desire, onClose, onSaved }: { desire: Desire | null; onClose: () => void; onSaved: () => void }) {
  const [story, setStory] = useState('');
  return (
    <Sheet visible={!!desire} onClose={onClose}>
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <Icon3D name="party" size={88} />
        <Text style={[type.title, { textAlign: 'center' }]}>{desire?.title}</Text>
        <Text style={[type.bodySoft, { textAlign: 'center' }]}>Tell the story. It becomes evidence for the next one.</Text>
      </View>
      <TextInput
        style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
        value={story}
        onChangeText={setStory}
        placeholder="How did it show up?"
        placeholderTextColor={colors.textMuted}
        multiline
      />
      <Button
        title="Mark as manifested"
        onPress={async () => {
          if (!desire) return;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          await saveDesire({ id: desire.id, status: 'manifested', story: story.trim() || null });
          setStory('');
          onSaved();
          onClose();
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: space.lg, gap: space.sm, ...shadow },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  link: { fontFamily: fonts.bodyHeavy, color: colors.accent, fontSize: 14 },
  scene: { backgroundColor: colors.surfaceSoft, borderRadius: radius.md, padding: space.md, gap: 4 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  action: { flex: 1, borderRadius: radius.pill, paddingVertical: 10, alignItems: 'center' },
  actionText: { fontFamily: fonts.bodyHeavy, fontSize: 13 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12 },
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
});
