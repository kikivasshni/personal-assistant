import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Blob, Card, PageHeader, Screen } from '@/components/ui';
import { COACHES } from '@/data/coaches';
import { db, Message } from '@/lib/db';
import { space, type } from '@/theme';

export default function Coaches() {
  const [last, setLast] = useState<Record<string, Message>>({});

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const rows = await (await db()).getAllAsync<Message>(
          "SELECT m.* FROM messages m JOIN (SELECT coach, MAX(id) id FROM messages WHERE role != 'note' GROUP BY coach) x ON m.id = x.id",
        );
        setLast(Object.fromEntries(rows.map((r) => [r.coach, r])));
      })();
    }, []),
  );

  const [hq, ...rest] = COACHES;

  return (
    <Screen header={<PageHeader eyebrow="Your circle" title="Coaches" />}>
      <Card tint={hq.tint} onPress={() => router.push(`/chat/${hq.id}`)}>
        <View style={styles.row}>
          <Blob emoji={hq.emoji} tint="#FFFFFFAA" size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.title}>{hq.name}</Text>
            <Text style={type.small}>{hq.role} · sees everything</Text>
          </View>
        </View>
        <Text style={type.bodySoft} numberOfLines={2}>
          {last[hq.id]?.text ?? 'Plan your day, check what slipped, or just tell it what is going on.'}
        </Text>
      </Card>

      <View style={styles.grid}>
        {rest.map((c) => (
          <View key={c.id} style={styles.cell}>
            <Card tint={c.tint} onPress={() => router.push(`/chat/${c.id}`)} style={styles.coachCard}>
              <Blob emoji={c.emoji} tint="#FFFFFFAA" />
              <Text style={type.heading}>{c.name}</Text>
              <Text style={type.small} numberOfLines={2}>
                {c.role}
              </Text>
              <Text style={[type.small, { color: c.deep }]} numberOfLines={2}>
                {last[c.id] ? last[c.id].text : c.starters[0]}
              </Text>
            </Card>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  cell: { width: '50%', padding: space.xs },
  coachCard: { minHeight: 176, gap: 6 },
});
