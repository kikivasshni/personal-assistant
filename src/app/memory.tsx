import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button, Card, Empty, Field, Screen, Section } from '@/components/ui';
import { resolve } from '@/data/spaces';
import { Fact } from '@/lib/db';
import { addFact, allFacts, deleteFact, getProfile, setProfile } from '@/lib/memory';
import { palette, space, type } from '@/theme';

export default function Memory() {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [profile, setP] = useState('');
  const [saved, setSaved] = useState(false);
  const [newFact, setNewFact] = useState('');

  const load = useCallback(async () => {
    setFacts(await allFacts());
    setP(await getProfile());
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  return (
    <Screen>
      <Card tint={palette.lavender}>
        <Text style={type.title}>About you</Text>
        <Text style={type.bodySoft}>Every coach reads this first. Keep it current.</Text>
        <Field label="Profile" value={profile} onChangeText={(t) => (setP(t), setSaved(false))} multiline style={{ minHeight: 220 }} />
        <Button title={saved ? 'Saved' : 'Save profile'} variant="soft" onPress={() => setProfile(profile).then(() => setSaved(true))} />
      </Card>

      <Section title={`Remembered facts · ${facts.length}`}>
        <Card>
          <Field label="Add a fact" value={newFact} onChangeText={setNewFact} placeholder="e.g. My Terraform exam is booked for 28 Nov" />
          <Button title="Remember" onPress={() => addFact(newFact, 'hq').then(() => (setNewFact(''), load()))} disabled={!newFact.trim()} />
        </Card>
        {facts.length === 0 ? (
          <Card>
            <Empty icon="bookmarks-outline" title="Nothing yet" body="Coaches save facts as you talk to them." />
          </Card>
        ) : (
          facts.map((f) => (
            <Pressable
              key={f.id}
              onLongPress={() =>
                Alert.alert('Forget this?', f.text, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Forget', style: 'destructive', onPress: () => deleteFact(f.id).then(load) },
                ])
              }
            >
              <Card style={{ padding: space.md }}>
                <Text style={type.body}>{f.text}</Text>
                <View style={{ flexDirection: 'row' }}>
                  <Text style={type.small}>
                    {resolve(f.coach ?? 'hq').name} · {new Date(f.created_at).toLocaleDateString()}
                  </Text>
                </View>
              </Card>
            </Pressable>
          ))
        )}
        {facts.length > 0 && <Text style={[type.small, { textAlign: 'center' }]}>Long-press a fact to forget it.</Text>}
      </Section>
    </Screen>
  );
}
