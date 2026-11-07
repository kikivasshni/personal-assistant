import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { NotionNode, refreshMap, workspaceMap } from '@/lib/integrations/notion';
import { colors, fonts, radius, space, type } from '@/theme';
import { Sheet } from './ui';

// Pick a page or database from the Notion workspace map.
export function NotionPicker({
  visible,
  kind,
  title,
  onClose,
  onPick,
}: {
  visible: boolean;
  kind: 'page' | 'database';
  title: string;
  onClose: () => void;
  onPick: (n: NotionNode) => void;
}) {
  const [nodes, setNodes] = useState<NotionNode[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    workspaceMap()
      .then((n) => (n.length ? n : refreshMap()))
      .then((n) => {
        setErr(null);
        setNodes(n);
      })
      .catch((e: Error) => setErr(e.message));
  }, [visible]);

  const byId = useMemo(() => new Map((nodes ?? []).map((n) => [n.id, n])), [nodes]);
  const list = (nodes ?? [])
    .filter((n) => n.kind === kind && (byId.get(n.parent ?? '')?.kind !== 'database' || kind === 'database'))
    .filter((n) => !q || n.title.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 60);

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <TextInput style={styles.input} value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={colors.textMuted} />
      {!nodes && !err && <ActivityIndicator color={colors.accent} />}
      {err && <Text style={[type.small, { color: colors.danger }]}>{err}</Text>}
      {nodes && list.length === 0 && (
        <Text style={type.bodySoft}>
          Nothing found. In Notion, open the {kind} and choose ••• → Connections → add your Kairos integration, then try again.
        </Text>
      )}
      <View>
        {list.map((n) => {
          const parent = n.parent ? byId.get(n.parent) : null;
          return (
            <Pressable
              key={n.id}
              onPress={() => {
                onPick(n);
                onClose();
              }}
              style={styles.row}
            >
              <Text style={[type.body, { fontFamily: fonts.bodyBold }]}>{n.title}</Text>
              {parent ? <Text style={type.small}>in {parent.title}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
});
