import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ListViewToken,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Button, Empty, PageHeader, Pill, Screen } from '@/components/ui';
import { COACHES, coach } from '@/data/coaches';
import { openCommitments } from '@/lib/commitments';
import { Commitment, FeedItem } from '@/lib/db';
import { feedItems, markSeen, refreshPinterest, refreshYouTube, saveLink, toggleSaved } from '@/lib/feed';
import { colors, fonts, palette, radius, shadow, space, type } from '@/theme';

// A goal-tuned feed with a hard stop: after SESSION_CAP clips it shows your
// next commitment instead of more videos.
const SESSION_CAP = 10;

function playerHtml(embed: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${embed}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></body></html>`;
}

export default function Feed() {
  const [filter, setFilter] = useState<string>('all');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const [seenThisSession, setSeen] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [next, setNext] = useState<Commitment | null>(null);

  const load = useCallback(async (f = filter) => {
    setItems(await feedItems(f));
    setNext((await openCommitments())[0] ?? null);
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    setMsg(null);
    try {
      const yt = await refreshYouTube(filter === 'all' ? undefined : [filter]).catch((e: Error) => {
        setMsg(e.message);
        return 0;
      });
      const pins = await refreshPinterest();
      if (yt + pins) setMsg(`Added ${yt + pins} new clips and pins.`);
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const onViewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) {
      setActive(first.index);
      if (first.item?.id) {
        markSeen(first.item.id);
        setSeen((n) => n + 1);
      }
    }
  }).current;

  const capped = seenThisSession >= SESSION_CAP;
  const data = capped ? items.slice(0, active + 1) : items;

  return (
    <Screen
      scroll={false}
      padded={false}
      header={
        <>
          <PageHeader
            eyebrow="Remember why"
            title="Goal Feed"
            right={
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Pressable onPress={() => setAdding(true)} hitSlop={10}>
                  <Ionicons name="add-circle-outline" size={26} color={colors.accent} />
                </Pressable>
                <Pressable onPress={refresh} hitSlop={10} disabled={refreshing}>
                  {refreshing ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="refresh" size={24} color={colors.accent} />}
                </Pressable>
              </View>
            }
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            <Pill label="All" active={filter === 'all'} onPress={() => (setFilter('all'), load('all'))} />
            {COACHES.map((c) => (
              <Pill key={c.id} label={`${c.emoji} ${c.name}`} active={filter === c.id} tint={c.tint} onPress={() => (setFilter(c.id), load(c.id))} />
            ))}
          </ScrollView>
          {msg && <Text style={[type.small, { paddingHorizontal: space.lg, paddingBottom: space.sm }]}>{msg}</Text>}
        </>
      }
    >
      <View style={{ flex: 1 }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
        {items.length === 0 ? (
          <View style={{ padding: space.lg, gap: space.md }}>
            <Empty
              emoji="🎞"
              title="Your feed is empty"
              body="Tap refresh to pull Shorts for each coach, or + to save a TikTok, Reel, Short or Pinterest link."
            />
            <Button title="Fetch clips" icon="✨" onPress={refresh} loading={refreshing} />
          </View>
        ) : height > 0 ? (
          <FlatList
            data={data}
            keyExtractor={(i) => String(i.id)}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
            getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
            renderItem={({ item, index }) => (
              <Clip item={item} height={height} playing={index === active} onChanged={() => load()} />
            )}
            ListFooterComponent={
              capped ? (
                <View style={[styles.stop, { height }]}>
                  <Text style={{ fontSize: 44 }}>🏁</Text>
                  <Text style={[type.title, { textAlign: 'center' }]}>That's {SESSION_CAP}. Now go live it.</Text>
                  {next ? (
                    <>
                      <Text style={[type.bodySoft, { textAlign: 'center' }]}>Next up: {next.title}</Text>
                      <Button title="Do it now" onPress={() => router.push(`/chat/${next.coach}?prompt=${encodeURIComponent(`I'm starting "${next.title}" now. Keep me on it.`)}`)} />
                    </>
                  ) : (
                    <Button title="Plan something with The Oracle" onPress={() => router.push('/chat/hq')} />
                  )}
                  <Button title="Back to Today" variant="ghost" onPress={() => router.push('/')} />
                </View>
              ) : undefined
            }
          />
        ) : null}
      </View>
      <AddLink visible={adding} onClose={() => setAdding(false)} onSaved={() => load()} />
    </Screen>
  );
}

function Clip({ item, height, playing, onChanged }: { item: FeedItem; height: number; playing: boolean; onChanged: () => void }) {
  const k = coach(item.coach);
  const canEmbed = !!item.embed_url;
  return (
    <View style={[styles.page, { height }]}>
      <View style={[styles.frame, { backgroundColor: k.tint }]}>
        {canEmbed && playing ? (
          <WebView
            source={
              item.source === 'youtube'
                ? { html: playerHtml(item.embed_url!), baseUrl: 'https://oracle.kirthi.app' }
                : { uri: item.embed_url! }
            }
            style={{ flex: 1, backgroundColor: 'transparent' }}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
          />
        ) : item.thumb ? (
          <Image source={{ uri: item.thumb }} style={{ flex: 1 }} resizeMode={item.source === 'pinterest' ? 'cover' : 'cover'} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={{ fontSize: 42 }}>{k.emoji}</Text>
            <Text style={type.bodySoft}>{item.source === 'link' ? 'Saved link' : `Saved ${item.source}`}</Text>
          </View>
        )}
      </View>
      <View style={styles.meta}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.small, { color: k.deep }]}>
            {k.emoji} {k.name} · {item.source}
          </Text>
          <Text style={type.heading} numberOfLines={2}>
            {item.title ?? item.url}
          </Text>
        </View>
        <Pressable onPress={() => toggleSaved(item.id).then(onChanged)} hitSlop={10}>
          <Ionicons name={item.saved ? 'heart' : 'heart-outline'} size={24} color={item.saved ? palette.roseDeep : colors.textMuted} />
        </Pressable>
        <Pressable onPress={() => Linking.openURL(item.url)} hitSlop={10}>
          <Ionicons name="open-outline" size={22} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function AddLink({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const paste = async () => setUrl((await Clipboard.getStringAsync()).trim());

  const save = async () => {
    if (!/^https?:\/\//.test(url.trim())) {
      setErr('Paste a full link starting with https://');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await saveLink(url, tag ?? undefined);
      setUrl('');
      setTag(null);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={type.title}>Save a clip</Text>
        <Text style={type.bodySoft}>In TikTok, Instagram, YouTube or Pinterest tap Share → Copy link, then paste it here.</Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={url}
            onChangeText={setUrl}
            placeholder="https://"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button title="Paste" variant="soft" onPress={paste} />
        </View>
        <Text style={type.label}>For which coach? (optional)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {COACHES.map((c) => (
            <Pill key={c.id} label={`${c.emoji} ${c.name}`} active={tag === c.id} tint={c.tint} onPress={() => setTag(tag === c.id ? null : c.id)} />
          ))}
        </ScrollView>
        {err && <Text style={[type.small, { color: colors.danger }]}>{err}</Text>}
        <Button title="Save to feed" onPress={save} loading={saving} disabled={!url.trim()} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  filters: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  page: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
  frame: { flex: 1, borderRadius: radius.lg, overflow: 'hidden', ...shadow },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xs },
  stop: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  backdrop: { flex: 1, backgroundColor: '#2E2A3B55' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  input: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
});
