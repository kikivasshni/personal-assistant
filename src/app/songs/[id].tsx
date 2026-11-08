import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLive } from '@/lib/live';
import { Button, Card, Screen, Section, Segmented } from '@/components/ui';
import { Icon3D } from '@/components/Icon3D';
import { RichText } from '@/components/RichText';
import { Song } from '@/lib/db';
import { deleteSong, getSong, logPractice, setSongStatus } from '@/lib/hobbies';
import { palette, space, type } from '@/theme';

export default function SongScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [song, setSong] = useState<Song | null>(null);
  const load = useCallback(async () => setSong(await getSong(Number(id))), [id]);
  useLive(load);

  if (!song) return <Screen>{null}</Screen>;
  const ask = (q: string) => router.push(`/chat/hobby.guitar?prompt=${encodeURIComponent(q)}`);

  return (
    <Screen>
      <Stack.Screen options={{ title: '' }} />
      <Card tint={palette.peach}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Icon3D name={song.status === 'learned' ? 'star' : 'guitar'} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={type.title}>{song.title}</Text>
            {song.artist ? <Text style={type.bodySoft}>{song.artist}</Text> : null}
          </View>
        </View>
        <Segmented
          value={song.status}
          onChange={(s) => setSongStatus(song.id, s).then(load)}
          options={[
            { value: 'wishlist', label: 'Want to' },
            { value: 'learning', label: 'Learning' },
            { value: 'learned', label: 'Can play' },
          ]}
        />
      </Card>

      {song.notes ? (
        <Section title="Where you're at">
          <Card>
            <RichText text={song.notes} />
          </Card>
        </Section>
      ) : null}

      <Section title="Tabs">
        {song.tabs ? (
          <Card>
            <RichText text={song.tabs} />
          </Card>
        ) : (
          <Card>
            <Text style={type.bodySoft}>No tabs saved yet.</Text>
            <Button title="Write the tabs for me" variant="soft" icon="musical-notes" onPress={() => ask(`Write out the full tabs for ${song.title}${song.artist ? ` by ${song.artist}` : ''}, section by section, and save them to the song.`)} />
          </Card>
        )}
      </Section>

      <Card>
        <Button title="I practised this (+20 min)" icon="checkmark" onPress={() => logPractice('hobby.guitar', 20, `Practised ${song.title}`).then(() => Alert.alert('Logged', 'Nice. Streak kept alive.'))} />
        <Button title="Help me with a tricky part" variant="soft" onPress={() => ask(`I'm stuck on part of ${song.title}. Help me break it down.`)} />
        <Button
          title="Remove song"
          variant="ghost"
          onPress={() =>
            Alert.alert('Remove this song?', song.title, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => deleteSong(song.id).then(() => router.back()) },
            ])
          }
        />
      </Card>
    </Screen>
  );
}
