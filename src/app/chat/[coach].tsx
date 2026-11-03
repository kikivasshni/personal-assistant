import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Blob } from '@/components/ui';
import { RichText } from '@/components/RichText';
import { coach as getCoach } from '@/data/coaches';
import { Attachment, clearChat, history, sendMessage } from '@/lib/agent';
import { Message } from '@/lib/db';
import { colors, fonts, radius, space, type } from '@/theme';

const AUDIT_PROMPT =
  "It's my evening audit. Go through today's commitments with me: what got done, what slipped and why, and what moves to tomorrow. Then lock tomorrow's top 3 in.";

export default function Chat() {
  const params = useLocalSearchParams<{ coach: string; audit?: string; prompt?: string }>();
  const c = getCoach(params.coach);
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<(Attachment & { uri: string }) | null>(null);
  const autoSent = useRef(false);
  const list = useRef<FlatList<Message>>(null);

  const load = useCallback(async () => {
    setMessages(await history(c.id));
  }, [c.id]);

  const send = useCallback(
    async (raw: string) => {
      const body = raw.trim();
      if ((!body && !attachment) || busy) return;
      setText('');
      setError(null);
      setBusy(true);
      const att = attachment;
      setAttachment(null);
      // Show the user's message straight away.
      setMessages((m) => [
        ...m,
        { id: -Date.now(), coach: c.id, role: 'user', text: att ? `[Photo] ${body || 'What do you think?'}` : body, created_at: Date.now() },
      ]);
      try {
        await sendMessage(c.id, body || 'What do you think of this?', att ?? undefined);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
        load();
      }
    },
    [attachment, busy, c.id, load],
  );

  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  const pickImage = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.6 });
    if (!r.canceled && r.assets[0]?.base64) {
      setAttachment({ uri: r.assets[0].uri, base64: r.assets[0].base64, mimeType: r.assets[0].mimeType ?? 'image/jpeg' });
    }
  };

  const confirmClear = () =>
    Alert.alert('Clear this chat?', 'Shared memory stays. Only this conversation is removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => clearChat(c.id).then(load) },
    ]);

  return (
    <LinearGradient colors={[colors.bg, c.tint]} style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: colors.bg },
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <Blob icon={c.icon} tint={c.tint} color={c.deep} size={34} />
              <View>
                <Text style={{ fontFamily: fonts.display, fontSize: 18, color: colors.text }}>{c.name}</Text>
                <Text style={type.small}>{c.role}</Text>
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: space.md, gap: space.sm, flexGrow: 1 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Blob icon={c.icon} tint={c.tint} color={c.deep} size={72} />
              <Text style={[type.title, { textAlign: 'center' }]}>{c.name}</Text>
              <Text style={[type.bodySoft, { textAlign: 'center' }]}>{c.role}</Text>
              <View style={styles.starters}>
                {c.starters.map((s) => (
                  <Pressable key={s} onPress={() => send(s)} style={[styles.starter, { borderColor: c.deep + '55' }]}>
                    <Text style={[styles.starterText, { color: c.deep }]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => {
            if (item.role === 'note')
              return (
                <View style={[styles.note, { backgroundColor: c.tint }]}>
                  <Ionicons name="checkmark-circle" size={14} color={c.deep} />
                  <Text style={[type.small, { color: c.deep }]}>{item.text}</Text>
                </View>
              );
            const mine = item.role === 'user';
            return (
              <View style={[styles.bubble, mine ? [styles.mine, { backgroundColor: c.deep }] : styles.theirs]}>
                {mine ? (
                  <Text style={[type.body, { color: '#fff' }]}>{item.text}</Text>
                ) : (
                  <RichText text={item.text} />
                )}
              </View>
            );
          }}
          ListFooterComponent={
            <>
              {busy && (
                <View style={[styles.bubble, styles.theirs, { flexDirection: 'row', gap: 8, alignItems: 'center' }]}>
                  <ActivityIndicator color={c.deep} size="small" />
                  <Text style={type.small}>{c.name} is thinking…</Text>
                </View>
              )}
              {error && <Text style={[type.small, { color: colors.danger, padding: space.sm }]}>{error}</Text>}
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
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + space.sm }]}>
          <Pressable onPress={pickImage} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="image-outline" size={22} color={colors.textSoft} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={`Message ${c.name}`}
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <Pressable
            onPress={() => send(text)}
            disabled={busy || (!text.trim() && !attachment)}
            style={[styles.send, { backgroundColor: c.deep }, (busy || (!text.trim() && !attachment)) && { opacity: 0.4 }]}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xxl },
  starters: { gap: space.sm, marginTop: space.md, alignSelf: 'stretch' },
  starter: { borderWidth: 1, borderRadius: radius.pill, paddingVertical: 12, paddingHorizontal: space.md, backgroundColor: '#FFFFFFB3' },
  starterText: { fontFamily: fonts.bodyBold, fontSize: 15, textAlign: 'center' },
  bubble: { maxWidth: '86%', borderRadius: radius.md + 2, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 6 },
  note: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
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
