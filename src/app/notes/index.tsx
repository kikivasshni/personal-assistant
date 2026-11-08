import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLive } from '@/lib/live';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Button, Card, Empty, Field, Screen, Section } from '@/components/ui';
import { Note } from '@/lib/db';
import { allNotes, makeNotes, saveNotes, Source } from '@/lib/notes';
import { getSecret } from '@/lib/secrets';
import { colors, palette, space, type } from '@/theme';

export default function NotesScreen() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [files, setFiles] = useState<{ name: string; src: Source }[]>([]);
  const [module, setModule] = useState('');
  const [extra, setExtra] = useState('');
  const [toNotion, setToNotion] = useState(false);
  const [hasNotion, setHasNotion] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const firstLoad = useRef(true);
  const load = useCallback(async () => {
    setNotes(await allNotes());
    const ok = !!(await getSecret('notionToken'));
    setHasNotion(ok);
    // Default to saving in Notion once; don't re-tick it if you untick it.
    if (ok && firstLoad.current) setToNotion(true);
    firstLoad.current = false;
  }, []);
  useLive(load);

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*', 'text/plain'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (r.canceled) return;
    const picked = await Promise.all(
      r.assets.map(async (a) => ({
        name: a.name,
        src: { mimeType: a.mimeType ?? 'application/pdf', base64: await new File(a.uri).base64() },
      })),
    );
    setFiles((f) => [...f, ...picked].slice(0, 6));
  };

  const generate = async () => {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      const n = await makeNotes(files.map((f) => f.src), module, extra);
      const saved = await saveNotes(n, toNotion && hasNotion);
      setFiles([]);
      setExtra('');
      router.push(`/notes/${saved.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card tint={palette.sky}>
        <Text style={type.title}>Make notes</Text>
        <Text style={type.bodySoft}>Add lecture slides, PDFs or photos of the whiteboard. You’ll get clean notes, key terms, likely exam questions and flashcards.</Text>
        <Button title={files.length ? 'Add more files' : 'Choose files'} icon="attach" variant={files.length ? 'soft' : 'primary'} onPress={pick} />
        {files.map((f, i) => (
          <Text key={i} style={type.small}>
            • {f.name}
          </Text>
        ))}
        {files.length > 0 && (
          <>
            <Field label="Module" value={module} onChangeText={setModule} placeholder="e.g. IS442 Object-Oriented Programming" />
            <Field label="Anything specific?" value={extra} onChangeText={setExtra} placeholder="e.g. focus on design patterns" />
            {hasNotion && (
              <View style={styles.row}>
                <Text style={[type.body, { flex: 1 }]}>Also save to Notion</Text>
                <Switch value={toNotion} onValueChange={setToNotion} trackColor={{ true: colors.accent }} />
              </View>
            )}
            <Button title="Make my notes" icon="sparkles" onPress={generate} loading={busy} />
            {busy && <Text style={type.small}>Reading everything carefully. Up to a minute for long decks.</Text>}
          </>
        )}
        {err && <Text style={[type.small, { color: colors.danger }]}>{err}</Text>}
      </Card>

      <Section title="Your notes">
        {notes.length === 0 ? (
          <Card>
            <Empty icon="book-outline" title="No notes yet" body="Quizzes get sharper as your notes grow." />
          </Card>
        ) : (
          notes.map((n) => (
            <Card key={n.id} onPress={() => router.push(`/notes/${n.id}`)}>
              <Text style={type.small}>{n.module ?? 'Notes'}</Text>
              <Text style={type.heading}>{n.title}</Text>
              <Text style={type.small}>
                {new Date(n.created_at).toLocaleDateString()} · {JSON.parse(n.flashcards).length} flashcards{n.notion_url ? ' · in Notion' : ''}
              </Text>
            </Card>
          ))
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: space.sm } });
