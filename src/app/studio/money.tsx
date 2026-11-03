import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Button, Card, Empty, Pill, Screen, Section } from '@/components/ui';
import { RichText } from '@/components/RichText';
import { Txn } from '@/lib/db';
import { byCategory, categorise, CATEGORIES, importStatement, spendingReport, statements, transactions } from '@/lib/finance';
import { colors, fonts, palette, radius, space, type } from '@/theme';

const BAR_TINTS = [palette.sage, palette.lavender, palette.peach, palette.sky, palette.butter, palette.rose, palette.mint, palette.lilac];

export default function Money() {
  const [list, setList] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async (s?: string | null) => {
    const all = await statements();
    setList(all);
    const pick = s ?? current ?? all[0] ?? null;
    setCurrent(pick);
    setTxns(pick ? await transactions(pick) : []);
  }, [current]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const upload = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    setBusy(true);
    setMsg('Reading your statement. This takes about 20–40 seconds.');
    setReport(null);
    try {
      const base64 = await new File(r.assets[0].uri).base64();
      const res = await importStatement(base64);
      setMsg(`${res.statement}: ${res.count} transactions${res.review ? `, ${res.review} need your call` : ''}.`);
      await load(res.statement);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runReport = async () => {
    if (!current) return;
    setReporting(true);
    try {
      setReport(await spendingReport(current));
    } catch (e) {
      setReport(e instanceof Error ? e.message : String(e));
    } finally {
      setReporting(false);
    }
  };

  const review = txns.filter((t) => t.needs_review);
  const cats = byCategory(txns);
  const spent = cats.reduce((a, c) => a + c.total, 0);
  const max = cats[0]?.total ?? 1;

  return (
    <Screen>
      <Card tint={palette.sage}>
        <Text style={type.title}>Monthly check-in</Text>
        <Text style={type.bodySoft}>Download your DBS e-statement PDF from digibank, then drop it here. Nothing leaves your phone except the call to Gemini.</Text>
        <Button title="Upload statement PDF" icon="document-text-outline" onPress={upload} loading={busy} />
        {msg && <Text style={type.small}>{msg}</Text>}
      </Card>

      {list.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {list.map((s) => (
            <Pill key={s} label={s} active={s === current} onPress={() => load(s)} />
          ))}
        </ScrollView>
      )}

      {!current ? (
        <Card>
          <Empty icon="wallet-outline" title="No statements yet" body="Your first upload sets up your spending categories." />
        </Card>
      ) : (
        <>
          {review.length > 0 && (
            <Section title={`Needs your call · ${review.length}`}>
              {review.map((t) => (
                <ReviewItem key={t.id} t={t} onDone={() => load(current)} />
              ))}
            </Section>
          )}

          <Section title={`${current} · SGD ${spent.toFixed(2)} spent`}>
            <Card style={{ gap: 12 }}>
              {cats.map((c, i) => (
                <View key={c.category} style={{ gap: 4 }}>
                  <View style={styles.rowBetween}>
                    <Text style={type.body}>{c.category}</Text>
                    <Text style={[type.body, { fontFamily: fonts.bodyBold }]}>${c.total.toFixed(2)}</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.bar, { width: `${Math.max(4, (100 * c.total) / max)}%`, backgroundColor: BAR_TINTS[i % BAR_TINTS.length] }]} />
                  </View>
                </View>
              ))}
            </Card>
          </Section>

          <Card tint={palette.lavender}>
            {report ? <RichText text={report} /> : <Text style={type.bodySoft}>Get a written read on this month.</Text>}
            <Button title={report ? 'Rewrite report' : 'Write my report'} variant="soft" onPress={runReport} loading={reporting} />
            <Button
              title="Talk to the Finance coach"
              variant="ghost"
              onPress={() => router.push(`/chat/finance?prompt=${encodeURIComponent(`Let's go through my ${current} spending.`)}`)}
            />
          </Card>

          <Section title="Transactions">
            <Card style={{ gap: 0, paddingVertical: space.xs }}>
              {txns.map((t, i) => (
                <View key={t.id} style={[styles.txn, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.body}>{t.merchant}</Text>
                    <Text style={type.small}>
                      {t.date} · {t.category}
                    </Text>
                  </View>
                  <Text style={[type.body, { fontFamily: fonts.bodyBold, color: t.amount < 0 ? colors.success : colors.text }]}>
                    {t.amount < 0 ? '+' : ''}${Math.abs(t.amount).toFixed(2)}
                  </Text>
                </View>
              ))}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}

function ReviewItem({ t, onDone }: { t: Txn; onDone: () => void }) {
  return (
    <Card tint={palette.butter}>
      <View style={styles.rowBetween}>
        <Text style={type.heading}>{t.merchant}</Text>
        <Text style={type.heading}>${Math.abs(t.amount).toFixed(2)}</Text>
      </View>
      <Text style={type.bodySoft}>{t.question ?? `What was this on ${t.date}?`}</Text>
      <View style={styles.chips}>
        {CATEGORIES.map((c) => (
          <Pressable key={c} onPress={() => categorise(t, c, true).then(onDone)} style={styles.chip}>
            <Text style={styles.chipText}>{c}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={type.small}>Your answer is remembered for this merchant next month.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceSoft, overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5 },
  txn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#FFFFFFCC', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
});
