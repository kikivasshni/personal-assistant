import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Bar, Button, Card, Empty, Screen, Section, Segmented } from '@/components/ui';
import { Icon3D } from '@/components/Icon3D';
import { NotionPicker } from '@/components/NotionPicker';
import { Bucket, NoFinancePageError, setFinanceNotionParent, spendSummary, SpendSummary, syncFinanceToNotion } from '@/lib/finance';
import { kvGet, kvSet } from '@/lib/db';
import { colors, fonts, palette, radius, space, type } from '@/theme';

type Range = 'week' | 'month' | 'year';
const TINTS = [palette.sageDeep, palette.lavenderDeep, palette.peachDeep, palette.skyDeep, palette.butterDeep, palette.roseDeep, palette.mintDeep, palette.lilacDeep];
const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function Spending() {
  const [s, setS] = useState<SpendSummary | null>(null);
  const [range, setRange] = useState<Range>('month');
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const load = useCallback(async () => {
    setS(await spendSummary());
    setLastSync(await kvGet('finance_notion_synced'));
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const sync = async () => {
    setSyncing(true);
    setMsg(null);
    try {
      const url = await syncFinanceToNotion();
      const at = new Date().toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      await kvSet('finance_notion_synced', `${at}|${url}`);
      setLastSync(`${at}|${url}`);
    } catch (e) {
      if (e instanceof NoFinancePageError) setPicking(true);
      else setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  if (!s) return <Screen>{null}</Screen>;
  if (!s.latest)
    return (
      <Screen>
        <Card>
          <Empty icon="bar-chart-outline" title="No spending yet" body="Upload your first DBS statement and this fills in with weekly, monthly and yearly views." />
          <Button title="Upload a statement" onPress={() => router.push('/finance/statement')} />
        </Card>
      </Screen>
    );

  const series: Bucket[] = range === 'week' ? s.weeks : range === 'month' ? s.months : s.years;
  const headline = range === 'week' ? s.week : range === 'month' ? s.month : s.year;
  const compare =
    range === 'month' && s.lastMonth
      ? `${s.month > s.lastMonth ? '▲' : '▼'} ${fmt(Math.abs(s.month - s.lastMonth))} vs last month`
      : range === 'week'
        ? `avg ${fmt(s.weeks.slice(0, -1).reduce((a, w) => a + w.spent, 0) / 7)} / week before this`
        : `${fmt(s.year / Math.max(1, new Date().getMonth() + 1))} / month average`;
  const cats = range === 'year' ? s.categories.year : s.categories.month;
  const max = Math.max(1, ...series.map((b) => b.spent));
  const catMax = cats[0]?.total ?? 1;

  return (
    <Screen>
      <Segmented<Range>
        value={range}
        onChange={setRange}
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ]}
      />

      <Card tint={palette.sage}>
        <View style={styles.row}>
          <Icon3D name="barchart" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={type.label}>Spent this {range}</Text>
            <Text style={styles.big}>{fmt(headline)}</Text>
            <Text style={type.small}>{compare}</Text>
          </View>
        </View>
        <View style={styles.chart}>
          {series.map((b, i) => (
            <View key={b.key} style={styles.col}>
              <Text style={styles.colValue} numberOfLines={1}>
                {b.spent ? (b.spent >= 1000 ? `${(b.spent / 1000).toFixed(1)}k` : Math.round(b.spent)) : ''}
              </Text>
              <View style={styles.track}>
                <View style={{ height: `${(100 * b.spent) / max}%`, backgroundColor: i === series.length - 1 ? palette.sageDeep : palette.sageDeep + '77', borderRadius: 6 }} />
              </View>
              <Text style={styles.colLabel} numberOfLines={1}>
                {b.label}
              </Text>
            </View>
          ))}
        </View>
        <Text style={type.small}>Transfers between your own accounts aren’t counted. Statements up to {s.latest}.</Text>
      </Card>

      {cats.length > 0 && (
        <Section title={`By category · this ${range === 'year' ? 'year' : 'month'}`}>
          <Card style={{ gap: 12 }}>
            {cats.map((c, i) => (
              <View key={c.category} style={{ gap: 4 }}>
                <View style={styles.between}>
                  <Text style={type.body}>{c.category}</Text>
                  <Text style={[type.body, { fontFamily: fonts.bodyBold }]}>{fmt(c.total)}</Text>
                </View>
                <Bar value={c.total} max={catMax} color={TINTS[i % TINTS.length]} height={10} />
              </View>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Notion">
        <Card>
          <Text style={type.bodySoft}>
            Keeps a “Spending overview” page in Notion with yearly, monthly and weekly tables, plus a report page for each statement.
          </Text>
          {lastSync && (
            <Text style={[type.small, { color: palette.sageDeep }]} onPress={() => Linking.openURL(lastSync.split('|')[1])}>
              Last synced {lastSync.split('|')[0]} · open in Notion
            </Text>
          )}
          <Button title="Sync to Notion" variant="soft" icon="sync" loading={syncing} onPress={sync} />
          {msg && <Text style={[type.small, { color: colors.danger }]}>{msg}</Text>}
        </Card>
      </Section>

      <View style={styles.row}>
        <Button title="Statements" variant="ghost" icon="document-text-outline" onPress={() => router.push('/finance/statement')} style={{ flex: 1 }} />
        <Button title="Advisor" variant="ghost" icon="trending-up" onPress={() => router.push('/chat/finance.advisor')} style={{ flex: 1 }} />
      </View>

      <NotionPicker
        visible={picking}
        kind="page"
        title="Where should finance live?"
        onClose={() => setPicking(false)}
        onPick={async (n) => {
          await setFinanceNotionParent(n.id);
          sync();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  big: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.text },
  chart: { flexDirection: 'row', gap: 4, height: 150, alignItems: 'flex-end', marginTop: space.sm },
  col: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  colValue: { fontFamily: fonts.bodyBold, fontSize: 9, color: colors.textMuted },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end', backgroundColor: '#FFFFFF99', borderRadius: radius.sm },
  colLabel: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.textMuted },
});
