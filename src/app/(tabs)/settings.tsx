import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Field, PageHeader, Screen, Section } from '@/components/ui';
import { shareBackup } from '@/lib/backup';
import { kvGet, kvSet } from '@/lib/db';
import { generateText } from '@/lib/gemini';
import { connect, disconnect, GOOGLE, googleScheme, isConnected, MICROSOFT, Provider } from '@/lib/integrations/oauth';
import { NotionNode, testNotion, workspaceMap } from '@/lib/integrations/notion';
import { NotionPicker } from '@/components/NotionPicker';
import { connectHealth, healthAvailable, healthConnected, openHealthSettings } from '@/lib/health';
import { notionTasksDb } from '@/lib/tasks';
import { financeNotionParent, setFinanceNotionParent } from '@/lib/finance';
import { ensurePermission, getDailyTimes, openAlarmSettings, scheduleDaily, testNotification } from '@/lib/nags';
import { DEFAULT_HEAVY_MODEL, DEFAULT_MODEL, getSecret, SecretKey, setSecret } from '@/lib/secrets';
import { colors, palette, space, type } from '@/theme';

function SecretField({
  k,
  label,
  placeholder,
  hint,
  secure = true,
  onSaved,
}: {
  k: SecretKey;
  label: string;
  placeholder?: string;
  hint?: string;
  secure?: boolean;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState('');
  const [has, setHas] = useState(false);
  const [shown, setShown] = useState('');

  useFocusEffect(
    useCallback(() => {
      getSecret(k).then((v) => {
        setHas(!!v);
        setShown(!secure && v ? v : '');
        if (!secure && v) setValue(v);
      });
    }, [k, secure]),
  );

  const save = async () => {
    if (!value.trim() && secure) return;
    await setSecret(k, value);
    setHas(!!value.trim());
    if (secure) setValue('');
    onSaved?.();
  };

  return (
    <Field
      label={`${label}${has ? ' · saved' : ''}`}
      value={value}
      onChangeText={setValue}
      onEndEditing={save}
      placeholder={has && secure ? 'Saved. Type to replace' : placeholder ?? shown}
      secureTextEntry={secure}
      autoCapitalize="none"
      hint={hint}
    />
  );
}

function Row({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: space.sm }}>
      <View style={{ flex: 1 }}>
        <Text style={type.label}>{label}</Text>
        <Text style={type.body}>{value}</Text>
      </View>
      <Text style={[type.small, { color: colors.accent }]}>Change</Text>
    </Pressable>
  );
}

function Connection({ p, hint }: { p: Provider; hint: string }) {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      isConnected(p).then(setConnected);
    }, [p]),
  );
  return (
    <View style={{ gap: space.sm }}>
      <Text style={type.small}>{hint}</Text>
      {connected ? (
        <Button title={`Disconnect ${p.name}`} variant="ghost" onPress={() => disconnect(p).then(() => setConnected(false))} />
      ) : (
        <Button
          title={`Connect ${p.name}`}
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await connect(p);
              setConnected(true);
            } catch (e) {
              Alert.alert(`${p.name} didn't connect`, e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </View>
  );
}

export default function Settings() {
  const [gemini, setGemini] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [times, setTimes] = useState({ briefing: '08:00', audit: '21:00' });
  const [boards, setBoards] = useState('');
  const [googleId, setGoogleId] = useState('');
  const [notionMsg, setNotionMsg] = useState<string | null>(null);
  const [notionTesting, setNotionTesting] = useState(false);
  const [targets, setTargets] = useState<{ tasks: string | null; finance: string | null }>({ tasks: null, finance: null });
  const [picker, setPicker] = useState<'tasks' | 'finance' | null>(null);
  const [health, setHealth] = useState<'unavailable' | 'off' | 'on'>('off');
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getDailyTimes().then(setTimes);
      kvGet('pinterest_boards').then((b) => setBoards(b ?? ''));
      getSecret('googleClientId').then((g) => setGoogleId(g ?? ''));
      kvGet('last_backup_at').then((b) => setLastBackup(b ? new Date(Number(b)).toLocaleString() : null));
      loadTargets();
      (async () => setHealth(!(await healthAvailable()) ? 'unavailable' : (await healthConnected()) ? 'on' : 'off'))().catch(() => {});
    }, []),
  );

  // Which Notion database / page tasks and finance write to (auto-detected unless chosen).
  async function loadTargets() {
    const nodes = await workspaceMap().catch(() => [] as NotionNode[]);
    const title = (id: string | null) => (id ? (nodes.find((n) => n.id === id.replace(/-/g, ''))?.title ?? 'chosen page') : null);
    setTargets({ tasks: title(await notionTasksDb().catch(() => null)), finance: title(await financeNotionParent().catch(() => null)) });
  }

  const testGemini = async () => {
    setTesting(true);
    setGemini(null);
    try {
      const t = await generateText('Say hello to kirthi in one short, warm sentence.');
      setGemini(`Working. ${t}`);
    } catch (e) {
      setGemini(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const saveTimes = async () => {
    const ok = /^\d{1,2}:\d{2}$/;
    if (!ok.test(times.briefing) || !ok.test(times.audit)) {
      Alert.alert('Use 24-hour times', 'For example 08:00 and 21:00.');
      return;
    }
    if (!(await ensurePermission())) {
      Alert.alert('Notifications are off', 'Allow notifications for Kairos in Android settings.');
      return;
    }
    await scheduleDaily(times);
    Alert.alert('Scheduled', `Briefing at ${times.briefing}, audit at ${times.audit}, every day.`);
  };

  return (
    <Screen header={<PageHeader eyebrow="Settings" title="You" />}>
      <Card tint={palette.lavender} onPress={() => router.push('/memory')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Ionicons name="person-circle-outline" size={20} color={colors.accent} />
          <Text style={type.heading}>Profile and shared memory</Text>
        </View>
        <Text style={type.bodySoft}>What every coach knows about you. Edit or forget anything.</Text>
      </Card>

      <Section title="Gemini">
        <Card>
          <SecretField k="geminiApiKey" label="API key" placeholder="From aistudio.google.com/apikey" />
          <SecretField
            k="geminiModel"
            label="Chat model"
            placeholder={DEFAULT_MODEL}
            secure={false}
            hint="Used for chats, with low thinking effort and streaming so replies start fast."
          />
          <SecretField
            k="geminiHeavyModel"
            label="Heavy model"
            placeholder={DEFAULT_HEAVY_MODEL}
            secure={false}
            hint="Used for statements, notes, photos and briefings. Each model is the other's backup: if one is overloaded (503) after a few retries, Kairos switches to the other."
          />
          <Button title="Test Gemini" variant="soft" onPress={testGemini} loading={testing} />
          {gemini && <Text style={type.small}>{gemini}</Text>}
        </Card>
      </Section>

      <Section title="Nags and daily rhythm">
        <Card>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Field label="Briefing" value={times.briefing} onChangeText={(v) => setTimes((t) => ({ ...t, briefing: v }))} keyboardType="numbers-and-punctuation" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Audit" value={times.audit} onChangeText={(v) => setTimes((t) => ({ ...t, audit: v }))} keyboardType="numbers-and-punctuation" />
            </View>
          </View>
          <Button title="Save daily schedule" onPress={saveTimes} />
          <Button title="Send a test nag (5 s)" variant="soft" onPress={() => ensurePermission().then(testNotification)} />
          <Button title="Allow exact alarms" variant="ghost" onPress={openAlarmSettings} />
          <Text style={type.small}>
            On Samsung: Settings → Battery → Background usage limits → Never sleeping apps → add Kairos. Otherwise nags can arrive late.
          </Text>
        </Card>
      </Section>

      <Section title="Microsoft To Do">
        <Card>
          <Text style={type.small}>
            Your to-do list. To see the same tasks in Samsung Reminder: Reminder → Settings → Sync with Microsoft To Do. Tasks also mirror into your
            Notion tasks database (see Notion below).
          </Text>
          <SecretField k="msClientId" label="Application (client) ID" secure={false} placeholder="From your Azure app registration" />
          <Connection
            p={MICROSOFT}
            hint="In Azure → your app → Authentication → Add a platform → Mobile and desktop, add the redirect URI oracle://auth"
          />
        </Card>
      </Section>

      <Section title="Google Calendar">
        <Card>
          <SecretField
            k="googleClientId"
            label="OAuth client ID (iOS type)"
            secure={false}
            placeholder="xxxx.apps.googleusercontent.com"
            onSaved={() => getSecret('googleClientId').then((g) => setGoogleId(g ?? ''))}
          />
          <Connection
            p={GOOGLE}
            hint={
              googleId
                ? `app.json "scheme" must include: ${googleScheme(googleId)} (then rebuild once). See README.`
                : 'Create an OAuth client of type iOS with bundle ID com.kirthi.oracle. See README.'
            }
          />
        </Card>
      </Section>

      <Section title="Notion">
        <Card>
          <SecretField k="notionToken" label="Integration token" placeholder="ntn_… from notion.so/my-integrations" />
          <Text style={type.small}>
            In Notion, open each top-level page you want Kairos to work in (school notes, hobbies, finance, tasks) and choose ••• → Connections → your
            integration. Sub-pages are included. Kairos maps the structure and the coaches decide where new notes go.
          </Text>
          <Button
            title="Scan my Notion"
            variant="soft"
            icon="search"
            loading={notionTesting}
            onPress={async () => {
              setNotionTesting(true);
              try {
                setNotionMsg(await testNotion());
                await loadTargets();
              } catch (e) {
                setNotionMsg(e instanceof Error ? e.message : String(e));
              } finally {
                setNotionTesting(false);
              }
            }}
          />
          {notionMsg && <Text style={type.small}>{notionMsg}</Text>}
          <Row label="Tasks database" value={targets.tasks ?? 'None found'} onPress={() => setPicker('tasks')} />
          <Row label="Finance reports under" value={targets.finance ?? 'None found'} onPress={() => setPicker('finance')} />
          <NotionPicker
            visible={picker != null}
            kind={picker === 'tasks' ? 'database' : 'page'}
            title={picker === 'tasks' ? 'Your tasks database' : 'Where finance reports go'}
            onClose={() => setPicker(null)}
            onPick={async (n) => {
              if (picker === 'tasks') await kvSet('notion_tasks_db', n.id);
              else await setFinanceNotionParent(n.id);
              loadTargets();
            }}
          />
        </Card>
      </Section>

      <Section title="Samsung Health">
        <Card>
          <Text style={type.bodySoft}>
            Steps, workouts, sleep, weight and your cycle flow from Samsung Health through Health Connect into the Health coaches.
          </Text>
          <Text style={type.small}>
            First, in Samsung Health: Settings → Health Connect → allow Samsung Health to share data. Then connect here.
          </Text>
          {health === 'unavailable' ? (
            <Text style={type.small}>Health Connect isn&apos;t available in this build. Install the new development build (see README).</Text>
          ) : health === 'on' ? (
            <Button title="Connected · manage permissions" variant="ghost" onPress={openHealthSettings} />
          ) : (
            <Button
              title="Connect Samsung Health"
              onPress={() =>
                connectHealth()
                  .then((ok) => setHealth(ok ? 'on' : 'off'))
                  .catch((e: Error) => Alert.alert("Couldn't connect", e.message))
              }
            />
          )}
        </Card>
      </Section>

      <Section title="Goal Feed">
        <Card>
          <SecretField k="youtubeApiKey" label="YouTube Data API key" placeholder="From Google Cloud console" />
          <Field
            label="Pinterest boards"
            value={boards}
            onChangeText={setBoards}
            onEndEditing={() => kvSet('pinterest_boards', boards)}
            placeholder={'username/vision-board\nusername/fitness-inspo'}
            multiline
            autoCapitalize="none"
            hint="One public board per line. Pins show up in the feed under Manifestation."
          />
        </Card>
      </Section>

      <Section title="Backup">
        <Card>
          <Text style={type.bodySoft}>Everything lives on this phone. Export a copy now and then and save it to Google Drive.</Text>
          <Button title="Export backup" variant="soft" icon="cloud-download-outline" onPress={() => shareBackup().then(() => setLastBackup(new Date().toLocaleString()))} />
          <Text style={type.small}>{lastBackup ? `Last backup: ${lastBackup}` : 'No backup yet.'}</Text>
        </Card>
      </Section>

      <Text style={[type.small, { textAlign: 'center', color: colors.textMuted }]} onPress={() => Linking.openURL('https://aistudio.google.com/apikey')}>
        Kairos · made for kirthi
      </Text>
    </Screen>
  );
}
