import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Button, Card, Screen, Section } from '@/components/ui';
import { RichText } from '@/components/RichText';
import { Note } from '@/lib/db';
import { deleteNote, getNote } from '@/lib/notes';
import { colors, palette, radius, space, type } from '@/theme';

export default function NoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [note, setNote] = useState<Note | null>(null);
  const [card, setCard] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    getNote(Number(id)).then(setNote);
  }, [id]);

  if (!note) return <Screen>{null}</Screen>;
  const cards: { q: string; a: string }[] = JSON.parse(note.flashcards);
  const current = cards[card];

  const remove = () =>
    Alert.alert('Delete these notes?', note.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteNote(note.id).then(() => router.back()) },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: note.module ?? 'Notes' }} />
      <Text style={type.hero}>{note.title}</Text>

      {current && (
        <Pressable onPress={() => setFlipped((f) => !f)}>
          <View style={[styles.flash, { backgroundColor: flipped ? palette.mint : palette.sky }]}>
            <Text style={type.label}>
              {flipped ? 'Answer' : 'Question'} · {card + 1}/{cards.length}
            </Text>
            <Text style={[type.title, { textAlign: 'center' }]}>{flipped ? current.a : current.q}</Text>
            <Text style={type.small}>Tap to flip</Text>
          </View>
        </Pressable>
      )}
      {cards.length > 1 && (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Previous" variant="ghost" style={{ flex: 1 }} onPress={() => (setCard((c) => (c - 1 + cards.length) % cards.length), setFlipped(false))} />
          <Button title="Next" variant="soft" style={{ flex: 1 }} onPress={() => (setCard((c) => (c + 1) % cards.length), setFlipped(false))} />
        </View>
      )}

      <Button
        title="Quiz me on this"
        icon="📚"
        onPress={() =>
          router.push(
            `/chat/academics?prompt=${encodeURIComponent(`Quiz me on my notes "${note.title}". One question at a time, exam style, and be ruthless about wrong answers.\n\n${note.body.slice(0, 3500)}`)}`,
          )
        }
      />

      <Section title="Notes">
        <Card>
          <RichText text={note.body} />
        </Card>
      </Section>

      {note.notion_url && <Button title="Open in Notion" variant="soft" onPress={() => Linking.openURL(note.notion_url!)} />}
      <Button title="Delete notes" variant="danger" onPress={remove} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flash: {
    minHeight: 200,
    borderRadius: radius.lg,
    padding: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
