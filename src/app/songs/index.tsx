import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useLive } from '@/lib/live';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Empty, Screen, Section, Segmented, Sheet } from '@/components/ui';
import { Icon3D } from '@/components/Icon3D';
import { Song } from '@/lib/db';
import { listSongs, saveSong } from '@/lib/hobbies';
import { colors, fonts, palette, radius, space, type } from '@/theme';

const GROUPS: { status: Song['status']; title: string; icon: string }[] = [
  { status: 'learning', title: 'Learning now', icon: 'guitar' },
  { status: 'wishlist', title: 'Want to learn', icon: 'notes' },
  { status: 'learned', title: 'Can play', icon: 'star' },
];

export default function Songs() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => setSongs(await listSongs()), []);
  useLive(load);

  return (
    <Screen>
      <Card tint={palette.peach}>
        <View style={styles.row}>
          <Icon3D name="guitar" size={56} />
          <View style={{ flex: 1 }}>
            <Text style={type.title}>Your songs</Text>
            <Text style={type.bodySoft}>Ask the guitar coach to teach any song. It writes the tabs and saves them here.</Text>
          </View>
        </View>
        <View style={styles.row}>
          <Button title="Add a song" variant="soft" icon="add" onPress={() => setAdding(true)} style={{ flex: 1 }} />
          <Button title="Coach" variant="ghost" icon="chatbubble-ellipses-outline" onPress={() => router.push('/chat/hobby.guitar')} style={{ flex: 1 }} />
        </View>
      </Card>

      {songs.length === 0 && (
        <Card>
          <Empty icon="musical-notes-outline" title="No songs yet" body="Add one you're learning, or ask the coach: “Teach me the intro to Wonderwall.”" />
        </Card>
      )}

      {GROUPS.map((g) => {
        const list = songs.filter((s) => s.status === g.status);
        if (!list.length) return null;
        return (
          <Section key={g.status} title={`${g.title} · ${list.length}`}>
            <Card style={{ gap: 0, paddingVertical: space.xs }}>
              {list.map((s, i) => (
                <Pressable key={s.id} onPress={() => router.push(`/songs/${s.id}`)} style={[styles.song, i > 0 && styles.border]}>
                  <Icon3D name={g.icon} size={30} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { fontFamily: fonts.bodyBold }]}>{s.title}</Text>
                    <Text style={type.small} numberOfLines={1}>
                      {[s.artist, s.tabs ? 'tabs saved' : null, s.notes].filter(Boolean).join(' · ') || 'No notes yet'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              ))}
            </Card>
          </Section>
        );
      })}

      <AddSong visible={adding} onClose={() => setAdding(false)} onSaved={load} />
    </Screen>
  );
}

function AddSong({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [status, setStatus] = useState<Song['status']>('learning');
  return (
    <Sheet visible={visible} onClose={onClose} title="Add a song">
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Song" placeholderTextColor={colors.textMuted} autoFocus />
      <TextInput style={styles.input} value={artist} onChangeText={setArtist} placeholder="Artist" placeholderTextColor={colors.textMuted} />
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { value: 'wishlist', label: 'Want to' },
          { value: 'learning', label: 'Learning' },
          { value: 'learned', label: 'Can play' },
        ]}
      />
      <Button
        title="Save"
        disabled={!title.trim()}
        onPress={async () => {
          const s = await saveSong({ title: title.trim(), artist: artist.trim() || null, status });
          setTitle('');
          setArtist('');
          onSaved();
          onClose();
          if (status === 'learning')
            router.push(`/chat/hobby.guitar?prompt=${encodeURIComponent(`Teach me ${s.title}${s.artist ? ` by ${s.artist}` : ''}. Break it into sections with tabs, and save them to the song.`)}`);
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  song: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12 },
  border: { borderTopWidth: 1, borderTopColor: colors.border },
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
