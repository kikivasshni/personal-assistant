import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Blob, Card, PageHeader, Screen } from '@/components/ui';
import { palette, space, type } from '@/theme';

const TOOLS = [
  { href: '/studio/food', emoji: '🍓', title: 'Food log', body: 'Snap a meal. Get macros and a PCOS-friendly tip.', tint: palette.rose },
  { href: '/studio/money', emoji: '🌿', title: 'Money', body: 'Drop in your DBS statement. See where it went.', tint: palette.sage },
  { href: '/studio/notes', emoji: '📚', title: 'Study notes', body: 'Turn lecture slides into notes, flashcards and quizzes.', tint: palette.sky },
  { href: '/memory', emoji: '🧠', title: 'Shared memory', body: 'Everything your coaches remember about you.', tint: palette.lavender },
] as const;

export default function Studio() {
  return (
    <Screen header={<PageHeader eyebrow="Tools" title="Studio" />}>
      {TOOLS.map((t) => (
        <Card key={t.href} tint={t.tint} onPress={() => router.push(t.href)}>
          <View style={styles.row}>
            <Blob emoji={t.emoji} tint="#FFFFFFAA" size={52} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.title}>{t.title}</Text>
              <Text style={type.bodySoft}>{t.body}</Text>
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: space.md } });
