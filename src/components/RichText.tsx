import { Text, View } from 'react-native';
import { fonts, space, type } from '@/theme';

// Renders the light Markdown the coaches use: **bold**, bullets, numbers, # headings.
function inline(line: string, key: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <Text key={`${key}-${i}`} style={{ fontFamily: fonts.bodyHeavy }}>
        {p.slice(2, -2)}
      </Text>
    ) : (
      <Text key={`${key}-${i}`}>{p.replace(/(^|\s)\*([^*]+)\*/g, '$1$2')}</Text>
    ),
  );
}

export function RichText({ text, color }: { text: string; color?: string }) {
  const lines = text.split('\n');
  const base = [type.body, color ? { color } : null];
  return (
    <View style={{ gap: 4 }}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: space.xs }} />;
        let m: RegExpMatchArray | null;
        if ((m = line.match(/^#{1,3}\s+(.*)/)))
          return (
            <Text key={i} style={[type.heading, color ? { color } : null]}>
              {m[1]}
            </Text>
          );
        if ((m = line.match(/^\s*[-*•]\s+(.*)/)))
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 8, paddingLeft: 2 }}>
              <Text style={base}>•</Text>
              <Text style={[base, { flex: 1 }]}>{inline(m[1], String(i))}</Text>
            </View>
          );
        if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/)))
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={[base, { fontFamily: fonts.bodyBold }]}>{m[1]}.</Text>
              <Text style={[base, { flex: 1 }]}>{inline(m[2], String(i))}</Text>
            </View>
          );
        if ((m = line.match(/^>\s?(.*)/)))
          return (
            <Text key={i} style={[type.quote, { fontSize: 16 }]}>
              {m[1]}
            </Text>
          );
        return (
          <Text key={i} style={base}>
            {inline(line, String(i))}
          </Text>
        );
      })}
    </View>
  );
}
