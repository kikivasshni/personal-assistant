import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Icon3D } from '@/components/Icon3D';
import { RichText } from '@/components/RichText';
import { ThreadPanel } from '@/components/ThreadPanel';
import { resolve } from '@/data/spaces';
import { Attachment, clearChat, history, sendMessage } from '@/lib/agent';
import { Message } from '@/lib/db';
import { colors, fonts, radius, space, type } from '@/theme';

const AUDIT_PROMPT =
  "It's my evening audit. Go through today's commitments and tasks with me: what got done, what slipped and why, and what moves to tomorrow. Then lock tomorrow's top 3 in.";

function useKeyboardVisible() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return shown;
}

export default function Chat() {
  const params = useLocalSearchParams<{ id: string; audit?: string; prompt?: string }>();
  const t = useMemo(() => resolve(params.id), [params.id]);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const keyboard = useKeyboardVisible();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [attachment, setAttachment] = useState<(Attachment & { uri: string }) | null>(null);
  const autoSent = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<FlatList<Message>>(null);

  const load = useCallback(async () => {
    setMessages(await history(t.id));
  }, [t.id]);

  const send = useCallback(
    async (raw: string) => {
      const body = raw.trim();
      if ((!body && !attachment) || busy) return;
      setText('');
      setError(null);
      setBusy(true);
      setStream('');
      setLastSent(body);
      const att = attachment;
      setAttachment(null);
      setMessages((m) => [
        ...m,
        { id: -Date.now(), coach: t.id, role: 'user', text: att ? `[Photo] ${body || 'What do you think?'}` : body, created_at: Date.now() },
      ]);
      abort.current = new AbortController();
      try {
        await sendMessage(t.id, body || 'What do you think of this?', att ?? undefined, {
          onText: setStream,
          onStatus: setStatus,
          signal: abort.current.signal,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (e) {
        if (!abort.current?.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
        setStream('');
        setStatus(null);
        await load();
        setRefreshKey((k) => k + 1);
      }
    },
    [attachment, busy, t.id, load],
  );

  useEffect(() => {
    // load() sets state only after its await, so this doesn't cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().then(() => {
      if (autoSent.current) return;
      if (params.audit) {
        autoSent.current = true;
        send(AUDIT_PROMPT);
      } else if (params.prompt) {
        autoSent.current = true;
        send(String(params.prompt));
      }
    });
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);

  const pickImage = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.6 });
    if (!r.canceled && r.assets[0]?.base64) {
      setAttachment({ uri: r.assets[0].uri, base64: r.assets[0].base64, mimeType: r.assets[0].mimeType ?? 'image/jpeg' });
    }
  };

  const confirmClear = () =>
    Alert.alert('Clear this chat?', 'Shared memory stays. Only this conversation is removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => clearChat(t.id).then(load) },
    ]);

  const canSend = !busy && (!!text.trim() || !!attachment);

  return (
    <LinearGradient colors={[colors.bg, t.tint]} style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: colors.bg },
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <Icon3D name={t.icon} size={30} />
              <View style={{ flexShrink: 1 }}>
                <Text style={{ fontFamily: fonts.display, fontSize: 18, color: colors.text }} numberOfLines={1}>
                  {t.title}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {t.spaceObj.threads.length > 1 || t.custom ? t.spaceObj.name : t.subtitle}
                </Text>
              </View>
            </View>
          ),
          headerRight: () => (
            <Pressable onPress={confirmClear} hitSlop={12}>
              <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
            </Pressable>
          ),
        }}
      />
      {/* Android is edge-to-edge, so the window doesn't resize for the keyboard:
          padding behaviour, offset by the header, keeps the input above it. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        {t.panel && <ThreadPanel t={t} refreshKey={refreshKey} hidden={keyboard} />}
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: space.md, gap: space.sm, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon3D name={t.icon} size={96} />
              <Text style={[type.title, { textAlign: 'center' }]}>{t.title}</Text>
              <Text style={[type.bodySoft, { textAlign: 'center' }]}>{t.subtitle}</Text>
              <View style={styles.starters}>
                {t.starters.map((s) => (
                  <Pressable key={s} onPress={() => send(s)} style={[styles.starter, { borderColor: t.deep + '55' }]}>
                    <Text style={[styles.starterText, { color: t.deep }]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => {
            if (item.role === 'note')
              return (
                <View style={[styles.note, { backgroundColor: t.tint }]}>
                  <Ionicons name="checkmark-circle" size={14} color={t.deep} />
                  <Text style={[type.small, { color: t.deep }]}>{item.text}</Text>
                </View>
              );
            const mine = item.role === 'user';
            return (
              <View style={[styles.bubble, mine ? [styles.mine, { backgroundColor: t.deep }] : styles.theirs]}>
                {mine ? <Text style={[type.body, { color: '#fff' }]}>{item.text}</Text> : <RichText text={item.text} />}
              </View>
            );
          }}
          ListFooterComponent={
            <>
              {busy &&
                (stream ? (
                  <View style={[styles.bubble, styles.theirs]}>
                    <RichText text={stream} />
                  </View>
                ) : (
                  <View style={[styles.bubble, styles.theirs, styles.thinking]}>
                    <ActivityIndicator color={t.deep} size="small" />
                    <Text style={type.small}>{status ? `${status}…` : 'Thinking…'}</Text>
                  </View>
                ))}
              {error && (
                <View style={styles.errorBox}>
                  <Text style={[type.small, { color: colors.danger, flex: 1 }]}>{error}</Text>
                  {lastSent && (
                    <Pressable
                      onPress={() => send(lastSent)}
                      hitSlop={8}
                    >
                      <Text style={[styles.retry, { color: t.deep }]}>Retry</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </>
          }
        />
        {attachment && (
          <View style={styles.attachRow}>
            <Ionicons name="image" size={14} color={colors.textMuted} />
            <Text style={type.small}>Photo attached</Text>
            <Pressable onPress={() => setAttachment(null)}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        )}
        <View style={[styles.inputBar, { paddingBottom: (keyboard ? 0 : insets.bottom) + space.sm }]}>
          <Pressable onPress={pickImage} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="image-outline" size={22} color={colors.textSoft} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={`Message ${t.title}`}
            placeholderTextColor={colors.textMuted}
            multiline
          />
          {busy ? (
            <Pressable onPress={() => abort.current?.abort()} style={[styles.send, { backgroundColor: colors.textMuted }]}>
              <Ionicons name="stop" size={18} color="#fff" />
            </Pressable>
          ) : (
            <Pressable onPress={() => send(text)} disabled={!canSend} style={[styles.send, { backgroundColor: t.deep }, !canSend && { opacity: 0.4 }]}>
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 260 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xl },
  starters: { gap: space.sm, marginTop: space.md, alignSelf: 'stretch' },
  starter: { borderWidth: 1, borderRadius: radius.pill, paddingVertical: 12, paddingHorizontal: space.md, backgroundColor: '#FFFFFFB3' },
  starterText: { fontFamily: fonts.bodyBold, fontSize: 15, textAlign: 'center' },
  bubble: { maxWidth: '88%', borderRadius: radius.md + 2, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 6 },
  thinking: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  note: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, backgroundColor: '#FFE4E9', borderRadius: radius.sm },
  retry: { fontFamily: fonts.bodyHeavy, fontSize: 14 },
  attachRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: 4 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    backgroundColor: '#FFFFFFE6',
  },
  iconBtn: { height: 44, justifyContent: 'center' },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 22,
    paddingHorizontal: space.md,
    paddingTop: 11,
    paddingBottom: 11,
    maxHeight: 140,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
