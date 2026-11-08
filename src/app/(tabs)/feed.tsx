import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Linking,
  ListViewToken,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Button, Pill, Sheet } from '@/components/ui';
import { Icon3D } from '@/components/Icon3D';
import { ShortPlayer } from '@/components/ShortPlayer';
import { space as coach, SPACES as COACHES } from '@/data/spaces';
import { openCommitments } from '@/lib/commitments';
import { Commitment, FeedItem } from '@/lib/db';
import { feedItems, markSeen, refreshPinterest, refreshYouTube, saveLink, toggleSaved } from '@/lib/feed';
import { useLive } from '@/lib/live';
import { colors, fonts, radius, space, type } from '@/theme';

// A goal-tuned feed that plays like Shorts: full screen, autoplay, swipe up
// for the next clip. It has a hard stop: after SESSION_CAP clips it shows
// your next commitment instead of more videos.
const SESSION_CAP = 10;

// Clips within this many places of the one on screen keep a loaded (paused)
// player, so the next swipe starts instantly.
const PRELOAD = 1;

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export default function Feed() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<string>('all');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const [seenThisSession, setSeen] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [next, setNext] = useState<Commitment | null>(null);
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  const load = useCallback(
    async (f = filter) => {
      setItems(await feedItems(f));
      setNext((await openCommitments())[0] ?? null);
    },
    [filter],
  );
  useLive(load, { tables: ['feed_items', 'commitments'] });

  // Only play while you're looking: pause on another tab or in the background.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const playing = focused && appActive && !adding;

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

  // FlatList requires this callback never to change identity.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) {
      setActive(first.index);
      if (first.item?.id) {
        markSeen(first.item.id);
        setSeen((n) => n + 1);
      }
    }
  }, []);

  const pickFilter = (f: string) => {
    setFilter(f);
    setActive(0);
    load(f);
  };

  const capped = seenThisSession >= SESSION_CAP;
  const data = capped ? items.slice(0, active + 1) : items;

  return (
    <View style={styles.screen}>
      {focused && <StatusBar style="light" />}
      <View style={{ flex: 1 }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
        {items.length === 0 ? (
          <View style={[styles.empty, { paddingTop: insets.top + 120 }]}>
            <Ionicons name="film-outline" size={44} color="#fff" />
            <Text style={styles.emptyTitle}>Your feed is empty</Text>
            <Text style={styles.emptyBody}>Tap refresh to pull Shorts for each coach, or + to save a TikTok, Reel, Short or Pinterest link.</Text>
            <Button title="Fetch clips" icon="sparkles" onPress={refresh} loading={refreshing} />
          </View>
        ) : height > 0 ? (
          <FlatList
            data={data}
            keyExtractor={(i) => String(i.id)}
            pagingEnabled
            snapToInterval={height}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            showsVerticalScrollIndicator={false}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
            windowSize={3}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#fff" colors={[colors.accent]} progressViewOffset={insets.top + 80} />}
            renderItem={({ item, index }) => (
              <Clip item={item} height={height} active={index === active} suspended={!playing} mounted={Math.abs(index - active) <= PRELOAD} onChanged={() => load()} />
            )}
            ListFooterComponent={
              capped ? (
                <View style={[styles.stop, { height }]}>
                  <Ionicons name="flag" size={40} color="#fff" />
                  <Text style={[styles.emptyTitle, { fontSize: 24 }]}>That’s {SESSION_CAP}. Now go live it.</Text>
                  {next ? (
                    <>
                      <Text style={styles.emptyBody}>Next up: {next.title}</Text>
                      <Button
                        title="Do it now"
                        onPress={() => router.push(`/chat/${next.coach}?prompt=${encodeURIComponent(`I'm starting "${next.title}" now. Keep me on it.`)}`)}
                      />
                    </>
                  ) : (
                    <Button title="Plan something with Planner" onPress={() => router.push('/chat/hq')} />
                  )}
                  <Button title="Back to Today" variant="ghost" onPress={() => router.push('/')} />
                </View>
              ) : undefined
            }
          />
        ) : null}
      </View>

      {/* Floating top bar over the video, like Shorts. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']}
        style={[styles.top, { paddingTop: insets.top + space.xs }]}
        pointerEvents="box-none"
      >
        <View style={styles.topRow} pointerEvents="box-none">
          <Text style={styles.brand}>Goal Feed</Text>
          <View style={{ flexDirection: 'row', gap: space.lg }}>
            <Pressable onPress={() => setAdding(true)} hitSlop={10}>
              <Ionicons name="add-circle-outline" size={26} color="#fff" />
            </Pressable>
            <Pressable onPress={refresh} hitSlop={10} disabled={refreshing}>
              {refreshing ? <ActivityIndicator color="#fff" /> : <Ionicons name="refresh" size={24} color="#fff" />}
            </Pressable>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <Chip label="All" active={filter === 'all'} onPress={() => pickFilter('all')} />
          {COACHES.map((c) => (
            <Chip key={c.id} label={c.name} active={filter === c.id} onPress={() => pickFilter(c.id)} />
          ))}
        </ScrollView>
        {msg && <Text style={styles.msg}>{msg}</Text>}
      </LinearGradient>

      <AddLink visible={adding} onClose={() => setAdding(false)} onSaved={() => load()} />
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && { color: '#000' }]}>{label}</Text>
    </Pressable>
  );
}

function Clip({
  item,
  height,
  active,
  suspended,
  mounted,
  onChanged,
}: {
  item: FeedItem;
  height: number;
  active: boolean;
  suspended: boolean;
  mounted: boolean;
  onChanged: () => void;
}) {
  const k = coach(item.coach);
  const like = () => toggleSaved(item.id).then(onChanged);
  return (
    <View style={{ height, backgroundColor: '#000' }}>
      <ShortPlayer item={item} active={active} suspended={suspended} mounted={mounted} onLike={() => !item.saved && like()} />

      {/* Bottom shade so the caption reads over any video. */}
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']} style={styles.shade} pointerEvents="none" />

      <View style={styles.caption} pointerEvents="none">
        <View style={styles.coachRow}>
          <View style={[styles.coachDot, { backgroundColor: k.tint }]}>
            <Icon3D name={k.icon} size={22} />
          </View>
          <Text style={styles.coachName}>{k.name}</Text>
          <Text style={styles.source}>· {item.source}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {item.title ?? item.url}
        </Text>
      </View>

      <View style={styles.rail} pointerEvents="box-none">
        <RailButton icon={item.saved ? 'heart' : 'heart-outline'} color={item.saved ? '#FF4D79' : '#fff'} label={item.saved ? 'Saved' : 'Save'} onPress={like} />
        <RailButton
          icon="chatbubble-ellipses-outline"
          label="Coach"
          onPress={() =>
            router.push(`/chat/${item.coach}?prompt=${encodeURIComponent(`I just watched "${item.title ?? 'a clip'}" in my feed. Turn it into one thing I do today.`)}`)
          }
        />
        <RailButton icon="open-outline" label="Open" onPress={() => Linking.openURL(item.url)} />
      </View>
    </View>
  );
}

function RailButton({ icon, label, color = '#fff', onPress }: { icon: IconName; label: string; color?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.railBtn}>
      <Ionicons name={icon} size={30} color={color} style={styles.railIcon} />
      <Text style={styles.railLabel}>{label}</Text>
    </Pressable>
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
    <Sheet visible={visible} onClose={onClose} title="Save a clip">
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
      <Text style={type.label}>For which area? (optional)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {COACHES.map((c) => (
          <Pill key={c.id} label={c.name} active={tag === c.id} tint={c.tint} onPress={() => setTag(tag === c.id ? null : c.id)} />
        ))}
      </ScrollView>
      {err && <Text style={[type.small, { color: colors.danger }]}>{err}</Text>}
      <Button title="Save to feed" onPress={save} loading={saving} disabled={!url.trim()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: space.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingBottom: space.sm },
  brand: { fontFamily: fonts.display, fontSize: 22, color: '#fff' },
  filters: { gap: space.sm, paddingHorizontal: space.lg },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.18)' },
  chipActive: { backgroundColor: '#fff' },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#fff' },
  msg: { fontFamily: fonts.bodyMedium, fontSize: 13, color: '#fff', paddingHorizontal: space.lg, paddingTop: space.sm },
  empty: { flex: 1, alignItems: 'center', gap: space.md, paddingHorizontal: space.xl },
  emptyTitle: { fontFamily: fonts.display, fontSize: 20, color: '#fff', textAlign: 'center' },
  emptyBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  stop: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl, backgroundColor: '#000' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 220 },
  caption: { position: 'absolute', left: space.lg, right: 84, bottom: space.lg, gap: 6 },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coachDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  coachName: { fontFamily: fonts.bodyHeavy, fontSize: 15, color: '#fff' },
  source: { fontFamily: fonts.bodyMedium, fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: '#fff' },
  rail: { position: 'absolute', right: space.sm, bottom: space.lg + 4, alignItems: 'center', gap: space.lg },
  railBtn: { alignItems: 'center', gap: 2, width: 64 },
  railIcon: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  railLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
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
