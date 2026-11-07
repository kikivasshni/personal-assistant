import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Pill, Screen, Section } from '@/components/ui';
import { Icon3D } from '@/components/Icon3D';
import { Txn } from '@/lib/db';
import { answerQuestion, categorise, CATEGORIES, importStatement, pendingQuestions, statements, transactions } from '@/lib/finance';
import { colors, fonts, palette, radius, space, type } from '@/theme';

type Turn = { from: 'kairos' | 'me'; text: string };

export default function Statement() {
  const [list, setList] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [questions, setQuestions] = useState<Txn[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(
    async (s?: string | null) => {
      const all = await statements();
      setList(all);
      const pick = s ?? current ?? all[0] ?? null;
      setCurrent(pick);
      setTxns(pick ? await transactions(pick) : []);
      setQuestions(await pendingQuestions());
    },
    [current],
  );
  useFocusEffect(useCallback(() => void load(), [load]));

  const upload = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    setBusy(true);
    setMsg('Reading your statement. This takes about 20–40 seconds.');
    try {
      const base64 = await new File(r.assets[0].uri).base64();
      const res = await importStatement(base64);
      setMsg(`${res.statement}: ${res.count} transactions read.${res.review ? ` I have ${res.review} question${res.review > 1 ? 's' : ''} for you.` : ' All categorised.'}`);
      await load(res.statement);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card tint={palette.sage}>
        <View style={styles.row}>
          <Icon3D name="receipt" size={52} />
          <View style={{ flex: 1 }}>
            <Text style={type.title}>Monthly statement</Text>
            <Text style={type.bodySoft}>Download your DBS e-statement PDF from digibank and drop it in. I’ll ask about anything I can’t place.</Text>
          </View>
        </View>
        <Button title="Upload statement PDF" icon="document-text-outline" onPress={upload} loading={busy} />
        {msg && <Text style={type.small}>{msg}</Text>}
      </Card>

      {questions.length > 0 && <Probe key={questions[0].id} t={questions[0]} remaining={questions.length} onDone={() => load(current)} />}

      {list.length > 0 && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {list.map((s) => (
              <Pill key={s} label={s} active={s === current} onPress={() => load(s)} />
            ))}
          </ScrollView>
          <Section title={`Transactions · ${txns.length}`}>
            <Card style={{ gap: 0, paddingVertical: space.xs }}>
              {txns.map((t, i) => (
                <View key={t.id} style={[styles.txn, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.body}>{t.merchant}</Text>
                    <Text style={type.small} numberOfLines={1}>
                      {t.date} · {t.needs_review ? 'needs your answer' : t.category}
                      {t.note ? ` · ${t.note}` : ''}
                    </Text>
                  </View>
                  <Text style={[type.body, { fontFamily: fonts.bodyBold, color: t.amount < 0 ? colors.success : colors.text }]}>
                    {t.amount < 0 ? '+' : ''}${Math.abs(t.amount).toFixed(2)}
                  </Text>
                </View>
              ))}
            </Card>
          </Section>
          <Button title="See spending overview" variant="soft" icon="bar-chart-outline" onPress={() => router.push('/finance')} />
        </>
      )}
    </Screen>
  );
}

// One unclear transaction at a time, as a short conversation. Kairos keeps
// asking until it can categorise it, then remembers the merchant if it makes sense.
function Probe({ t, remaining, onDone }: { t: Txn; remaining: number; onDone: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([{ from: 'kairos', text: t.question ?? `What was this ${t.date} payment?` }]);
  const [answer, setAnswer] = useState('');
  const [thinking, setThinking] = useState(false);
  const [showCats, setShowCats] = useState(false);

  const send = async () => {
    const a = answer.trim();
    if (!a) return;
    setAnswer('');
    setTurns((x) => [...x, { from: 'me', text: a }]);
    setThinking(true);
    try {
      const context = turns.length > 1 ? `${turns.map((x) => `${x.from === 'me' ? 'kirthi' : 'Q'}: ${x.text}`).join(' / ')} / kirthi: ${a}` : a;
      const r = await answerQuestion(t, context);
      if (r.done) {
        setTurns((x) => [...x, { from: 'kairos', text: `Got it: ${r.category}.` }]);
        setTimeout(onDone, 600);
      } else setTurns((x) => [...x, { from: 'kairos', text: r.followUp! }]);
    } catch (e) {
      setTurns((x) => [...x, { from: 'kairos', text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <Section title={`Quick question · ${remaining} left`}>
      <Card tint={palette.butter}>
        <View style={styles.between}>
          <View style={{ flex: 1 }}>
            <Text style={type.heading}>{t.merchant}</Text>
            <Text style={type.small}>
              {t.date} · {t.statement}
            </Text>
          </View>
          <Text style={styles.amount}>${Math.abs(t.amount).toFixed(2)}</Text>
        </View>
        {turns.map((x, i) => (
          <View key={i} style={[styles.bubble, x.from === 'me' ? styles.mine : styles.theirs]}>
            <Text style={[type.body, x.from === 'me' && { color: '#fff' }]}>{x.text}</Text>
          </View>
        ))}
        {thinking && <ActivityIndicator color={palette.butterDeep} style={{ alignSelf: 'flex-start' }} />}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={answer}
            onChangeText={setAnswer}
            placeholder="e.g. Dinner with Priya, she paid half back"
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable onPress={send} disabled={!answer.trim() || thinking} style={[styles.send, (!answer.trim() || thinking) && { opacity: 0.4 }]}>
            <Ionicons name="arrow-up" size={18} color="#fff" />
          </Pressable>
        </View>
        <Pressable onPress={() => setShowCats(!showCats)}>
          <Text style={[type.small, { color: palette.butterDeep, fontFamily: fonts.bodyHeavy }]}>{showCats ? 'Hide categories' : 'Or just pick a category'}</Text>
        </Pressable>
        {showCats && (
          <View style={styles.chips}>
            {CATEGORIES.map((c) => (
              <Pressable key={c} onPress={() => categorise(t, c, true).then(onDone)} style={styles.chip}>
                <Text style={styles.chipText}>{c}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  amount: { fontFamily: fonts.display, fontSize: 22, color: colors.text },
  txn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: space.sm },
  bubble: { maxWidth: '88%', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#FFFFFFDD' },
  mine: { alignSelf: 'flex-end', backgroundColor: palette.butterDeep },
  inputRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.butterDeep, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#FFFFFFCC', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
});
