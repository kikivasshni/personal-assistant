import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, PageHeader, Screen } from '@/components/ui';
import { Icon3D } from '@/components/Icon3D';
import { SPACES, threadsFor } from '@/data/spaces';
import { openSpace } from '@/lib/nav';
import { kvGet } from '@/lib/db';
import { listDesires } from '@/lib/desires';
import { spendSummary } from '@/lib/finance';
import { snapshot } from '@/lib/health';
import { practiceStats } from '@/lib/hobbies';
import { colors, fonts, space, type } from '@/theme';

const daysAgo = (n: number | null) => (n == null ? 'not started' : n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

// One live line per space, so the grid tells you something at a glance.
async function statusLines(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const jobs: Promise<void>[] = [
    snapshot()
      .then((s) => {
        if (s) out.health = `${s.today.steps.toLocaleString()} steps today`;
      })
      .catch(() => {}),
    kvGet('exam:study.aws').then((d) => {
      if (d) {
        const n = Math.ceil((Date.parse(d) - Date.now()) / 86_400_000);
        if (n >= 0) out.academics = `SAP-C03 in ${n} days`;
      }
    }),
    practiceStats('hobby.guitar').then((p) => {
      out.hobbies = `Guitar ${daysAgo(p.daysSince)}`;
    }),
    listDesires().then((d) => {
      const pending = d.filter((x) => x.status === 'pending').length;
      const done = d.filter((x) => x.status === 'manifested').length;
      if (d.length) out.manifest = `${pending} assuming · ${done} manifested`;
    }),
    spendSummary()
      .then((s) => {
        if (s.latest) out.finance = `$${Math.round(s.month).toLocaleString()} spent this month`;
      })
      .catch(() => {}),
  ];
  await Promise.all(jobs);
  return out;
}

export default function Life() {
  const [status, setStatus] = useState<Record<string, string>>({});

  useFocusEffect(
    useCallback(() => {
      statusLines().then(setStatus).catch(() => {});
    }, []),
  );

  const [hq, ...rest] = SPACES;

  return (
    <Screen header={<PageHeader eyebrow="Your life, in rooms" title="Life" />}>
      <Card tint={hq.tint} onPress={() => openSpace(hq)}>
        <View style={styles.row}>
          <Icon3D name={hq.icon} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.title}>{hq.name}</Text>
            <Text style={type.bodySoft}>{hq.tagline}. Plan the day, the week, or check what slipped.</Text>
          </View>
        </View>
      </Card>

      <View style={styles.grid}>
        {rest.map((s) => {
          const count = threadsFor(s.id).length;
          return (
            <View key={s.id} style={styles.cell}>
              <Card tint={s.tint} onPress={() => openSpace(s)} style={styles.spaceCard}>
                <View style={styles.cardTop}>
                  <Icon3D name={s.icon} size={52} />
                  {count > 1 && (
                    <View style={styles.count}>
                      <Text style={[styles.countText, { color: s.deep }]}>{count}</Text>
                    </View>
                  )}
                </View>
                <Text style={type.heading}>{s.name}</Text>
                <Text style={type.small} numberOfLines={2}>
                  {s.tagline}
                </Text>
                {status[s.id] ? (
                  <View style={[styles.status, { backgroundColor: '#FFFFFFB3' }]}>
                    <Text style={[styles.statusText, { color: s.deep }]} numberOfLines={1}>
                      {status[s.id]}
                    </Text>
                  </View>
                ) : null}
              </Card>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  cell: { width: '50%', padding: space.xs },
  spaceCard: { minHeight: 172, gap: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  count: { backgroundColor: '#FFFFFFB3', borderRadius: 999, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { fontFamily: fonts.bodyHeavy, fontSize: 12 },
  status: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 'auto' },
  statusText: { fontFamily: fonts.bodyHeavy, fontSize: 12, color: colors.text },
});
