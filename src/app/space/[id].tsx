import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLive } from '@/lib/live';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Screen, Sheet, SpaceHeader } from '@/components/ui';
import { Icon3D, PICKABLE_ICONS } from '@/components/Icon3D';
import { space as getSpace, Thread, threadsFor } from '@/data/spaces';
import { cardStatus } from '@/lib/cardStatus';
import { addCustomThread, removeCustomThread } from '@/lib/hobbies';
import { openThread } from '@/lib/nav';
import { colors, fonts, radius, space, type } from '@/theme';

export default function SpaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = getSpace(id);
  const [threads, setThreads] = useState<Thread[]>(threadsFor(s.id));
  const [status, setStatus] = useState<Record<string, string | null>>({});
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    const list = threadsFor(s.id);
    setThreads(list);
    Promise.all(list.map(async (t) => [t.id, await cardStatus(t)] as const)).then((rows) => setStatus(Object.fromEntries(rows)));
  }, [s.id]);
  useLive(load, { ignore: ['messages'] });

  const remove = (t: Thread) =>
    Alert.alert(`Remove ${t.title}?`, 'Its chat history goes too. Your Notion pages stay.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeCustomThread(t.id).then(load) },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: '' }} />
      <SpaceHeader icon={s.icon} tint={s.tint} eyebrow={s.name} title={s.tagline} />

      {threads.map((t) => (
        <Card key={t.id} style={styles.card}>
          <Pressable
            onLongPress={t.custom ? () => remove(t) : undefined}
            delayLongPress={400}
            onPress={() => openThread(t)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: s.tint }]}>
              <Icon3D name={t.icon} size={44} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.heading}>{t.title}</Text>
              <Text style={type.small} numberOfLines={2}>
                {t.subtitle}
              </Text>
              {status[t.id] ? <Text style={[styles.status, { color: s.deep }]}>{status[t.id]}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        </Card>
      ))}

      {s.add && (
        <Pressable onPress={() => setAdding(true)} style={[styles.add, { borderColor: s.deep + '66' }]}>
          <Icon3D name="plus" size={28} />
          <Text style={[styles.addText, { color: s.deep }]}>{s.add.label}</Text>
        </Pressable>
      )}
      {threads.some((t) => t.custom) && <Text style={[type.small, { textAlign: 'center' }]}>Long-press a card you added to remove it.</Text>}

      {s.add && (
        <AddCard
          visible={adding}
          noun={s.add.noun}
          tint={s.tint}
          deep={s.deep}
          onClose={() => setAdding(false)}
          onAdd={async (title, icon, about) => {
            const newId = await addCustomThread(s.id, title, icon, about);
            setAdding(false);
            load();
            router.push(`/chat/${newId}?prompt=${encodeURIComponent(`I want to start on ${title}. ${about}`.trim())}`);
          }}
        />
      )}
    </Screen>
  );
}

function AddCard({
  visible,
  noun,
  tint,
  deep,
  onClose,
  onAdd,
}: {
  visible: boolean;
  noun: string;
  tint: string;
  deep: string;
  onClose: () => void;
  onAdd: (title: string, icon: string, about: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [icon, setIcon] = useState<string>('sparkles');
  const [saving, setSaving] = useState(false);
  return (
    <Sheet visible={visible} onClose={onClose} title={`New ${noun}`}>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder={noun === 'hobby' ? 'e.g. Music production' : 'e.g. AWS ML Engineer Associate'}
        placeholderTextColor={colors.textMuted}
        autoFocus
      />
      <TextInput
        style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
        value={about}
        onChangeText={setAbout}
        placeholder="Where you're at and what you want from it (optional)"
        placeholderTextColor={colors.textMuted}
        multiline
      />
      <Text style={type.label}>Icon</Text>
      <View style={styles.icons}>
        {PICKABLE_ICONS.map((k) => (
          <Pressable key={k} onPress={() => setIcon(k)} style={[styles.iconPick, icon === k && { backgroundColor: tint, borderColor: deep }]}>
            <Icon3D name={k} size={30} />
          </Pressable>
        ))}
      </View>
      <Button
        title={`Add ${noun}`}
        loading={saving}
        disabled={!title.trim()}
        onPress={async () => {
          setSaving(true);
          try {
            await onAdd(title.trim(), icon, about.trim());
            setTitle('');
            setAbout('');
          } finally {
            setSaving(false);
          }
        }}
      />
      <Text style={type.small}>Its coach will keep your Notion notes for it in the same structure as your other notes.</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconWrap: { width: 60, height: 60, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  status: { fontFamily: fonts.bodyHeavy, fontSize: 12, marginTop: 2 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    paddingVertical: space.md,
  },
  addText: { fontFamily: fonts.bodyHeavy, fontSize: 15 },
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
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconPick: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surface },
});
