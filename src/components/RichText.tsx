import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, palette, radius, space, type } from '@/theme';

// Renders the light Markdown the coaches use: **bold**, bullets, numbers,
// # headings, > quotes, simple tables, fenced code, and ```tab guitar tabs.

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

function inline(line: string, key: string) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**'))
      return (
        <Text key={`${key}-${i}`} style={{ fontFamily: fonts.bodyHeavy }}>
          {p.slice(2, -2)}
        </Text>
      );
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
      return (
        <Text key={`${key}-${i}`} style={styles.inlineCode}>
          {p.slice(1, -1)}
        </Text>
      );
    return <Text key={`${key}-${i}`}>{p.replace(/(^|\s)\*([^*]+)\*/g, '$1$2')}</Text>;
  });
}

const STRING_COLORS: Record<string, string> = {
  e: palette.roseDeep,
  B: palette.peachDeep,
  G: palette.butterDeep,
  D: palette.mintDeep,
  A: palette.skyDeep,
  E: palette.lilacDeep,
};

// Guitar tab: dark "fretboard" card, monospace, string names coloured,
// scrolls sideways if a riff is wider than the screen.
function Tab({ lines }: { lines: string[] }) {
  return (
    <View style={styles.tab}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {lines.map((l, i) => {
            const m = l.match(/^\s*([eBGDAE])\s*(\|.*)$/);
            if (!m)
              return (
                <Text key={i} style={[styles.tabLine, { color: '#C9C3DD' }]}>
                  {l}
                </Text>
              );
            return (
              <Text key={i} style={styles.tabLine}>
                <Text style={{ color: STRING_COLORS[m[1]] ?? '#fff', fontWeight: '700' }}>{m[1]}</Text>
                {m[2].split(/(\d+|[hpbr\/\\~x])/).map((seg, k) =>
                  /^\d+$/.test(seg) ? (
                    <Text key={k} style={styles.fret}>
                      {seg}
                    </Text>
                  ) : /^[hpbr\/\\~x]$/.test(seg) ? (
                    <Text key={k} style={{ color: palette.butter }}>
                      {seg}
                    </Text>
                  ) : (
                    <Text key={k}>{seg}</Text>
                  ),
                )}
              </Text>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function Code({ lines }: { lines: string[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.code}>
      <Text style={styles.codeText}>{lines.join('\n')}</Text>
    </ScrollView>
  );
}

function Table({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.table}>
        {[head, ...body].map((r, i) => (
          <View key={i} style={[styles.tr, i === 0 && styles.th, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            {r.map((c, k) => (
              <Text key={k} style={[type.small, styles.td, { color: colors.text }, i === 0 && { fontFamily: fonts.bodyHeavy }]}>
                {c}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const looksLikeTab = (lines: string[]) => lines.filter((l) => /^\s*[eBGDAE]\s*\|/.test(l)).length >= 4;

export function RichText({ text, color }: { text: string; color?: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const base = [type.body, color ? { color } : null];
  const out: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    let m: RegExpMatchArray | null;

    if ((m = line.match(/^\s*```\s*(\w*)/))) {
      const lang = m[1];
      const block: string[] = [];
      while (++i < lines.length && !lines[i].trimStart().startsWith('```')) block.push(lines[i]);
      out.push(lang === 'tab' || looksLikeTab(block) ? <Tab key={i} lines={block} /> : <Code key={i} lines={block} />);
      continue;
    }
    // Tabs written without a fence.
    if (/^\s*[eBGDAE]\s*\|/.test(line) && looksLikeTab(lines.slice(i, i + 6))) {
      const block: string[] = [];
      for (; i < lines.length && /^\s*[eBGDAE]\s*\|/.test(lines[i]); i++) block.push(lines[i]);
      i--;
      out.push(<Tab key={i} lines={block} />);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) continue;
        rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()));
      }
      i--;
      out.push(<Table key={i} rows={rows} />);
      continue;
    }
    if (!line.trim()) {
      out.push(<View key={i} style={{ height: space.xs }} />);
      continue;
    }
    if ((m = line.match(/^#{1,3}\s+(.*)/))) {
      out.push(
        <Text key={i} style={[type.heading, { marginTop: 4 }, color ? { color } : null]}>
          {m[1]}
        </Text>,
      );
      continue;
    }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      out.push(
        <View key={i} style={{ flexDirection: 'row', gap: 8, paddingLeft: 2 }}>
          <Text style={base}>•</Text>
          <Text style={[base, { flex: 1 }]}>{inline(m[1], String(i))}</Text>
        </View>,
      );
      continue;
    }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/))) {
      out.push(
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={[base, { fontFamily: fonts.bodyBold }]}>{m[1]}.</Text>
          <Text style={[base, { flex: 1 }]}>{inline(m[2], String(i))}</Text>
        </View>,
      );
      continue;
    }
    if ((m = line.match(/^>\s?(.*)/))) {
      out.push(
        <Text key={i} style={[type.quote, { fontSize: 16 }]}>
          {m[1]}
        </Text>,
      );
      continue;
    }
    out.push(
      <Text key={i} style={base}>
        {inline(line, String(i))}
      </Text>,
    );
  }
  return <View style={{ gap: 4 }}>{out}</View>;
}

const styles = StyleSheet.create({
  inlineCode: { fontFamily: MONO, fontSize: 14, backgroundColor: colors.surfaceSoft },
  tab: { backgroundColor: '#2E2A3B', borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 14, marginVertical: 4 },
  tabLine: { fontFamily: MONO, fontSize: 14, lineHeight: 21, color: '#8E88A3' },
  fret: { color: '#FFFFFF', fontWeight: '700' },
  code: { backgroundColor: colors.surfaceSoft, borderRadius: radius.sm, padding: 10, marginVertical: 2 },
  codeText: { fontFamily: MONO, fontSize: 13, lineHeight: 19, color: colors.text },
  table: { borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginVertical: 4 },
  tr: { flexDirection: 'row' },
  th: { backgroundColor: colors.surfaceSoft },
  td: { minWidth: 72, maxWidth: 180, paddingHorizontal: 10, paddingVertical: 6 },
});
